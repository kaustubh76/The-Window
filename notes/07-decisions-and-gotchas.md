# 07 — Decisions & Gotchas

Consolidated design decisions and footguns, each with the WHY and WHERE. Sources:
`spike/NOTES.md` (D1 eERC teardown), `spike/GATE.md` (D2 go/no-go), `METHODOLOGY.md`,
and the code itself. Sibling context: architecture in `01-architecture.md`, contracts
in `02-contracts.md`, circuits in `03-circuits-and-proving.md`, services in
`04-services.md`, dashboard in `05-dashboard.md`, run/ops in `06-demo-and-ops.md`.

## Contents

- [Committed verifiers ≠ shipped zkeys](#committed-verifiers--shipped-zkeys)
- [Chunked PoCD — the EIP-170 problem, RESOLVED](#chunked-pocd--the-eip-170-problem-resolved)
- [The D2 gate decision — no commit-reveal pivot](#the-d2-gate-decision--no-commit-reveal-pivot)
- [PrivateTransfer has no plaintext amount → auditor-attested funding](#privatetransfer-has-no-plaintext-amount--auditor-attested-funding)
- [Vault-operator EOA custody pattern](#vault-operator-eoa-custody-pattern)
- [Two ElGamal decrypt conventions](#two-elgamal-decrypt-conventions)
- [102-signal-per-chunk ordering coupling](#102-signal-per-chunk-ordering-coupling)
- [Oracle recomputes the clearing rate on-chain](#oracle-recomputes-the-clearing-rate-on-chain)
- [eERC converter at 6 decimals + deployment order](#eerc-converter-at-6-decimals--deployment-order)
- [Browser vs Node eERC implementations](#browser-vs-node-eerc-implementations)
- [Indexer has no persistence — by design](#indexer-has-no-persistence--by-design)
- [One NonceManager per key](#one-noncemanager-per-key)
- [Honest-claim guardrail + leak budget](#honest-claim-guardrail--leak-budget)
- [Cloud hosting gotchas (Render / Docker / Vercel)](#cloud-hosting-gotchas-render--docker--vercel)
- [KNOWN DOC DRIFT (to eventually fix)](#known-doc-drift-to-eventually-fix)

---

## Committed verifiers ≠ shipped zkeys

**What**: the eERC submodule's committed `contracts/verifiers/*CircuitGroth16Verifier.sol`
do NOT match its shipped `circom/build/*/*.zkey`. A proof made with the shipped zkey
verifies offline against the shipped `*_verification_key.json` but the committed
verifier returns `false` on-chain → `InvalidProof()` (selector `0x09bde339`).

**Why it matters**: silent, maddening failure mode — everything looks correct offline.
Rule: *always regenerate the Solidity verifier from the exact zkey used for proving*
(`snarkjs zkey export solidityverifier <zkey> <Verifier>.sol`).

**Where**: spike/NOTES.md:63-71. The regenerated verifiers live in
`contracts/src/verifiers/eerc/*Gen.sol` and are what `DeployAll` deploys
(contracts/script/DeployAll.s.sol:11-15, 51-55).

## Chunked PoCD — the EIP-170 problem, RESOLVED

**History**: the original monolithic 37-tick array PoCD verifier (372 public signals)
compiled to **62,708 bytes** of deployed code, far over EIP-170's 24,576-byte runtime
limit. It only ran locally via a stack of hacks: `anvil --code-size-limit 200000`, a
raw `cast send --create` pre-deploy in `deploy_local.sh`, and a
`DEPTH_ARRAY_VERIFIER_ADDR` env var into `DeployAll` — and it could never deploy to a
real network (Fuji/mainnet enforce EIP-170).

**Resolution (implemented)**: the PoCD is now **chunked** — `DepthPoCDArray(N)` is
instantiated at **N = 10** and the curve is proven as **K = 4 chunk proofs** over tick
ranges `[0..9], [10..19], [20..29], [30..36]` (+3 padded virtual ticks), 102 public
signals each. The regenerated `DepthPoCDArrayVerifier` is **17,892 bytes — under
EIP-170** — and deploys inline like any contract; the anvil flag, cast pre-deploy, and
env var are all gone (removed from `DeployAll.s.sol`, `scripts/deploy_local.sh`,
`demo/run_demo.sh`, `demo/run_autonomous.sh`). This is what made the **live Fuji
deployment** possible (chunk verifier at
`0x71548d2B3CEE856E17315e2E286491233E571E75`, size verified via `cast code` — see
`06-demo-and-ops.md`).

**Why N=10 two-sided chunks** (rather than Readme §15's sketched bid/ask split into
2 × 187 signals, which at ~24KB/verifier would still have been dangerously close to the
limit): 102 signals ≈ 18KB leaves real headroom, keeps ONE circuit/zkey/verifier for
all four chunks (`_buildChunkSignals` just slices by k), and each chunk stays
side-symmetric (both ask and bid per tick), so the circuit is unchanged except for N.

**Why the padding is sound**: virtual ticks 37–39 are padded with the identity point
`(0,1)` and claimed sum 0 on **both** sides — the prover (`genDepthArrayProof`,
eerc.mjs:59-63) and the contract (`_buildChunkSignals`, MONIAOracle.sol:174-181) —
which is *exactly* what `AuctionHouse.getAggregate` returns for empty real ticks
(AuctionHouse.sol:144), and `Dec(identity) = identity = 0·G` was already proven
acceptable for empty ticks in the monolith. Nothing new is trusted; a pad mismatch
fails verification like any other signal mismatch.

**Cross-chunk soundness**: swapping two individually-valid chunk proofs fails, because
each chunk's public-signal vector embeds its *own* accumulator slice — tested on-chain
both at the adapter level (`DepthPoCDArrayGate.t.sol` `test_CrossChunkProofFails`) and
through `postPrint` (`MONIAOracleArrayIntegration.t.sol` `test_SwappedChunkProofsRevert`).

**Cost**: proving is ~30 s for all 4 chunks measured locally — `run_fuji.sh:21`
budgets ~40 s of epoch headroom for it (was ~40 s for the monolith); the full
`postPrint` runs at ~5.0M gas in the integration test (4 × Groth16 verify ≈ 860k each
+ storage) vs ~4.1M for the old single proof — same order. Verified e2e on a vanilla
Anvil (`deploy_local.sh` + `register_all` + `demo/verify_backend.mjs` → PASS, both
loan paths, real proofs) and live on Fuji.

**Where**: contracts/src/MONIAOracle.sol:18-24, 82-118, 158-226;
circuits/depth_pocd/depth_pocd_array.circom:5-26, 66;
packages/eerc-node/src/eerc.mjs:42-83; contracts/script/DeployAll.s.sol:74-77.
Note spike/NOTES.md:83-87 still describes the monolith + cast workaround — stale, see
the drift list.

## The D2 gate decision — no commit-reveal pivot

**What**: before building the full system, a hard gate (Readme §8.2) required proving
two things in the EVM; both passed, so the homomorphic + PoCD architecture was built
and the pre-authorized commit-reveal fallback (Readme §8.4) was never taken.

- (a) External contracts CAN homomorphically accumulate eERC ciphertexts on-chain:
  `ToyAccumulator` + `BabyJubJub._add` on `c1`/`c2`; **≈12,981 gas per add**
  (2 point-adds + SSTORE) — far under the ~500k budget (spike/GATE.md:9-13).
- (b) A PoCD over the on-chain sum verifies on-chain: single-sum circuit ~12k
  constraints, valid proof verifies at **~266k gas**, tampered claimed sum (350→351)
  fails, tampered proof element fails (spike/GATE.md:15-21).

**Why it matters**: this is why `AuctionHouse` stores an EGCT accumulator per
(epoch, side, tick), and why `MONIAOracle.postPrint` binds the proof to on-chain
accumulators instead of admin-supplied numbers (spike/GATE.md:29-33).

**Where**: spike/GATE.md (decision at :3), `contracts/src/spike/ToyAccumulator.sol`,
`circuits/depth_pocd/depth_pocd.circom`.

## PrivateTransfer has no plaintext amount → auditor-attested funding

**What**: eERC's `PrivateTransfer(from, to, uint256[7] auditorPCT, auditorAddress)`
event carries **no plaintext amount and no EGCT** — only an auditor-decryptable
Poseidon ciphertext (spike/NOTES.md:44). So a third-party contract (LoanBook) cannot
verify a funding transfer's magnitude trustlessly on-chain.

**Decision**: funding and repayment are **auditor-attested**. The admin watches
transfers, decrypts the `auditorPCT` with the auditor key, checks parties + amount,
then calls `LoanBook.confirmFunding(loanId, ref)` / `repay(loanId, ref)` — both
`onlyAdmin` (contracts/src/LoanBook.sol:102, :114). The contract enforces *lifecycle
finality* (no fund before lock — `vault.isLocked` check at LoanBook.sol:105 — no
repay-after-seize, deadline safety), not transfer magnitude.

**The accountability tradeoff**: this is stated openly as a trusted surface in
METHODOLOGY.md §5 ("Funding / repayment magnitude is auditor-attested, not
contract-enforced", METHODOLOGY.md:47) — the SOFR model: confidential inputs,
accountable administrator, public benchmark. Do not "fix" this by pretending an event
can be verified; it can't.

**Where**: spike/NOTES.md:40-45 (Q5), METHODOLOGY.md:44-49, LoanBook.sol:102-114.

## Vault-operator EOA custody pattern

**What**: `CollateralVault` holds **authority, not custody**. Encrypted collateral sits
in a registered vault-operator **EOA**; the contract holds the records and gates the
lifecycle.

**Why**: an eERC balance belongs to a registered account with its own BabyJubJub key
that can generate client-side proofs. A Solidity contract cannot hold a BJJ private
key or produce proofs, so it cannot be a first-class eERC account (METHODOLOGY.md:48).

**The two-step lock**: borrower calls `lockCollateral(loanId, cColl, cLoan, ownerPub,
a,b,c)` with a valid solvency proof → state `Requested`, emits `LockRequested`
(CollateralVault.sol:74-100); the operator escrows the encrypted collateral and calls
`confirmLock(loanId, collateralRef)` (`onlyOperator`) → state `Locked`
(CollateralVault.sol:104-112). Only a `Locked` loan can be funded
(LoanBook.sol:105). Terminal moves (`release` on repay, `seizeTo` on default) finalize
on-chain atomically and emit orders the operator executes off the event; there is
deliberately **no** confirm step for release/seize — the loan is already terminal, an
extra confirm would be theater (METHODOLOGY.md:48).

**Where**: METHODOLOGY.md:48, contracts/src/CollateralVault.sol:72-135,
services/operator/index.mjs:1-4.

## Two ElGamal decrypt conventions

**What**: `packages/eerc-node/src/eerc.mjs` has two decrypt functions that look
interchangeable and are not:

- `decryptEGCT(privateKey, eGCT, maxUnits)` (eerc.mjs:168-173) — applies
  `formatPrivKeyForBabyJub` to the key first. This is the **eERC user convention**:
  use it for eERC *balances* (deposit/transfer/withdraw eGCTs), where keys were
  registered as `formatPrivKeyForBabyJub(raw) % subOrder`.
- `decryptEGCTDirect(scalar, eGCT, maxUnits)` (eerc.mjs:179-187) — uses the scalar
  **directly** (`M = c2 − scalar·c1`). This is the **auction/PoCD auditor
  convention**: bid sizes are encrypted with `encryptMessage(auditorPub, size)` where
  `auditorPub = S·G` for the raw scalar S, and the DepthCurve circuit uses S directly
  as `auditorPriv` (comment at eerc.mjs:175-178; usage in
  services/lib/adminops.mjs:38-39 and demo/scenario.mjs:57-58).

**Why it's a footgun**: using the wrong one doesn't error — BSGS just never finds the
scalar ("bsgs: not found within maxUnits") or, worse, times out on a huge range.
Rule of thumb: *eERC balance → `decryptEGCT`; auction aggregate / anything encrypted
via `encryptMessage` to the auditor scalar → `decryptEGCTDirect`.* Related: BSGS is
only for small bounded ranges (per-tick aggregates); large 6-decimal balances should
be decrypted via the Poseidon `balancePCT` path instead (spike/NOTES.md:81).

**Where**: packages/eerc-node/src/eerc.mjs:166-187.

## 102-signal-per-chunk ordering coupling

**What**: each chunk proof's public-signal vector is
`auditorPub[2], askC1[10][2], askC2[10][2], askSum[10], bidC1[10][2], bidC2[10][2],
bidSum[10]` = 2 + 10·10 = **102** (× 4 chunks per print), and circom flattens arrays
**grouped, not interleaved**. `MONIAOracle._buildChunkSignals(epoch, depth, k)`
rebuilds exactly this layout for tick slice `k*10 .. k*10+9` from on-chain
accumulators, padding ticks ≥ 37 with `(0,1)`/0 (contracts/src/MONIAOracle.sol:158-226,
layout comment at :148-157); the circuit declares it in
`component main { public [ auditorPub, askC1, askC2, askSum, bidC1, bidC2, bidSum ] } = DepthPoCDArray(10)`
(circuits/depth_pocd/depth_pocd_array.circom:66, layout comment at :24-26).

**Why it matters**: change either side — reorder the `public [...]` list, change N or
K, insert a signal, change the padding — and every print reverts with `BadProof` even
though the proofs themselves are valid. The coupling is intentional (it binds each
proof to its slice of on-chain state), but it means the circuit,
`_buildChunkSignals`, and the prover-side constants (`POCD_CHUNK_TICKS`/`POCD_CHUNKS`
+ padding in `genDepthArrayProof`, eerc.mjs:42-63) must be modified **together**, the
verifier regenerated from the new zkey (see the first gotcha), and
`MONIAOracle.CHUNK_TICKS`/`CHUNKS` kept in sync. The tick count also has a third
constraint: `CHUNKS*CHUNK_TICKS (40) >= TICKS (37)`.

**Where**: MONIAOracle.sol:18-24, 148-226; depth_pocd_array.circom:24-26, 66;
packages/eerc-node/src/eerc.mjs:42-63.

## Oracle recomputes the clearing rate on-chain

**What**: `postPrint` doesn't trust the admin's claimed `rStarTick`. After verifying
the 4 chunk PoCDs it runs `_computeClearing(depth)` on-chain over the proof-verified
depth and reverts `WrongClearingTick` if the claim differs (MONIAOracle.sol:100-112);
no-trade epochs must claim `NO_TRADE` (:103-110).

**Why**: with the PoCD proving the depth is the true decryption of the on-chain
accumulators, and r\* recomputed on-chain from that depth, the admin **cannot lie about
r\*** even with a valid proof. The off-chain mirror in `services/lib/adminops.mjs:16-27`
(and demo/scenario.mjs) must stay in lockstep with `_computeClearing` or prints
revert — the on-chain version is the source of truth.

**Where**: contracts/src/MONIAOracle.sol:82-146, services/lib/adminops.mjs:15-27.

## eERC converter at 6 decimals + deployment order

**What**: the `EncryptedERC` converter is deployed with `decimals: 6` to match TestUSDC
(`SimpleERC20("Test USDC","tUSDC", 6)`) — DeployAll.s.sol:50, 63. eERC internally
scales via `_convertFrom`/`_convertTo` and returns deposit remainders as dust; **never
assume 2 decimals** — read the deployed value (spike/NOTES.md:31).

**Deployment order constraints** (spike/NOTES.md:89-97): TestUSDC → eERC verifiers
(regenerated `*Gen.sol`) → `Registrar(registrationVerifier)` → `EncryptedERC`
(converter, decimals=6) → *admin registers in Registrar, then*
`setAuditorPublicKey(adminEOA)` (requires the target already registered —
spike/NOTES.md:37; done post-deploy in `register_all.mjs:35-45` because registration
needs client-side proofs) → WINDOW verifiers → MemberRegistry → AuctionHouse →
MONIAOracle → CollateralVault → LoanBook → one-time wiring setters
(DeployAll.s.sol:91-94). Note deposits/wrap **fail until the auditor is set**
(`onlyIfAuditorSet`, spike/NOTES.md:29) — which is why `register_all.mjs` must run
after every fresh deploy.

**Where**: DeployAll.s.sol:49-69, spike/NOTES.md:28-31 (Q3), 89-97,
packages/eerc-node/src/register_all.mjs:33-48.

## Browser vs Node eERC implementations

**What**: two independent eERC crypto implementations exist, deliberately:

- **Server-side (authoritative)**: `packages/eerc-node/src/eerc.mjs` — snarkjs +
  `@zk-kit/baby-jubjub` + `maci-crypto` + `poseidon-lite`, the same libraries the
  protocol uses, so its proofs are accepted by the deployed contracts (eerc.mjs:1-3).
  All proof-bearing writes run here, invoked by the services and the Control API.
- **Browser**: the dashboard does **not** generate eERC proofs. Its mock adapter has a
  browser ElGamal port (`dashboard/src/lib/adapter/mock/elgamal.browser.ts`,
  circomlibjs-based) so the Explorer shows genuine ciphertexts, and in live mode all
  writes go through the **Control API** (`VITE_CONTROL_URL`, config.ts:53-55), where
  the server-side implementation does the proving.

**Why**: heavy Groth16 proving and auditor-key handling belong server-side ("the
auditor key never leaves" — services/control/index.mjs:1-4), while the browser only
needs display-grade crypto for the mock simulation.

**Caveat / drift**: `spike/NOTES.md:101` says the dashboard uses `@avalabs/eerc-sdk`
v1.0.2 (React hooks), and `dashboard/.env.example` still mentions
"`@avalabs/eerc-sdk` writes" — but `dashboard/package.json` has **no such dependency**;
the SDK plan was superseded by the Control API (commit 15b508e). See the drift list.

**Where**: packages/eerc-node/src/eerc.mjs, dashboard/src/lib/adapter/mock/elgamal.browser.ts,
dashboard/src/config.ts:53-55, services/control/index.mjs:1-4.

## Indexer has no persistence — by design

**What**: the indexer keeps everything in an in-memory `state` object and *rebuilds it
from chain events* on boot and on every poll — "Crash-safe: no persistence, re-derives
everything from chain on boot + poll" (services/indexer/index.mjs:1-4, `rebuild()` at
:32). The keeper is likewise stateless (services/keeper/index.mjs:1-3), relying on
contract reverts for idempotency.

**Why (tradeoff)**: no DB, no migrations, no possibility of the indexer disagreeing
with the chain — kill any service at any time and restart it. The cost: O(chain-length)
rebuild via `queryFilter(…, 0, "latest")` on every cycle, fine for a demo-length local
chain, not for a long-lived network (that's a deliberate non-goal).

**Where**: services/indexer/index.mjs:1-4,32-166.

## One NonceManager per key

**What**: `services/lib/chain.mjs` wraps every signer in `ethers.NonceManager`
(chain.mjs:26-28), and `handles(pk)` returns a **cached bundle** — all eight contract
handles for a given key share ONE NonceManager, and repeated `handles(pk)` calls return
the same bundle (chain.mjs:36-59).

**Why**: services fire transactions from several contracts for the same EOA in quick
succession; with independent wallets each would fetch the same pending nonce and
collide ("nonce too low" / replacement-underpriced races). One shared NonceManager
keeps nonces in sync across every contract and call site.

**The pitfall**: creating a *second* wallet/NonceManager for the same key in the same
process desyncs the cached one — NonceManager tracks nonces locally and won't see
transactions sent by the other instance. Note the `contract(addr, name, pk)` helper
(chain.mjs:30-33) builds a **fresh** NonceManager per call — don't mix it with
`handles(pk)` for the same key; use `handles(pk)` everywhere (all services do).

**Where**: services/lib/chain.mjs:26-59.

## Honest-claim guardrail + leak budget

**What**: the privacy claims are deliberately bounded (METHODOLOGY.md §4):

- **Hidden**: bid sizes, loan sizes, collateral, repayments, balances, any individual's
  borrowing history.
- **Visible**: rate ticks bid at, **member addresses** (eERC hides amounts, *not*
  sender/receiver), epoch timing, prints, aggregate depth, loan counts/lifecycle,
  seizure events (METHODOLOGY.md:36).
- **The administrator can decrypt everything** under the auditor key — accountable,
  rotatable, PoCD-audited, and never denied: *"We never claim 'undecryptable,'
  'trustless,' or 'nobody can see the bids'"* (METHODOLOGY.md:38).

**Enforcement**: the dashboard CI greps every source file for forbidden phrases —
`/trustless/i`, `/undecryptable/i`, `/unbreakable/i`, `/nobody|no one can (see|decrypt)/i`,
`/fully anonymous/i` (dashboard/src/lib/honestClaims.ts:5-12, test in
`honestClaims.test.ts`) — and asserts every M-ONIA print renders a PoCD badge
(dashboard/README.md:62-68). Server-side, the admin surface has the hard rule "never
log plaintext sizes" (services/lib/adminops.mjs:1-2).

**Why**: overclaiming privacy is the fastest way to lose a technical judge; the
SOFR-style accountable-administrator model is the pitch, not a weakness. When writing
ANY copy or docs, keep to this budget.

**Where**: METHODOLOGY.md:32-49, dashboard/src/lib/honestClaims.ts,
services/lib/adminops.mjs:1-2.

## Subnet-EVM / permissioned-L1 gotchas

See [09-permissioned-l1.md](09-permissioned-l1.md) for the full L1 story. The two that
bite hardest, both fixed in `services/keeper/index.mjs`:

1. **Demand-block chains freeze "latest block timestamp"** between txs — never use it
   alone as "now" for scheduling; the keeper uses `max(chain time, wall clock)`.
2. **Gas estimation simulates against the stale latest block**, so a time-gated call
   (`closeEpoch`) can revert at ESTIMATION even though the actual tx's fresh block
   would pass — the keeper sends time-gated calls with an explicit `gasLimit` to skip
   estimation. State-gated calls are unaffected.

## Cloud hosting gotchas (Render / Docker / Vercel)

Footguns hit while hosting the stack publicly (see [08-hosting-and-deployment.md](08-hosting-and-deployment.md)
for the full setup). All discovered the hard way.

1. **Render `dockerCommand` is naively tokenized — no `sh -c`.** A start command of
   `sh -c 'INDEXER_PORT=$PORT node …'` fails at boot with **exit 127** (Render splits the
   string on whitespace and mis-parses the quotes). **Fix**: use a plain exec command
   (`node services/indexer/index.mjs`) and set the port via a **static env var**
   `INDEXER_PORT`/`CONTROL_PORT=10000` (= Render's default `$PORT`) — you can't expand
   `$PORT` inside the command.
2. **Must cross-build `--platform linux/amd64`.** The Mac is arm64; an arm64 image won't run
   on Render (amd64). `docker buildx build --platform linux/amd64 … --push`. Verify with
   `docker buildx imagetools inspect <img>` before deploying.
3. **Gitignored runtime files must be baked into the image.** `contracts/out` ABIs,
   `contracts/deployments/43113.json`, and the `circuits/build/*` zkeys+wasm are gitignored,
   so Render can't build the backend from a git clone. The `Dockerfile` uses **selective
   `COPY`** to bake exactly the ~110 MB of runtime artifacts (not the 1.5 GB `circuits/build`).
   Tunneling the local services (cloudflared) was considered and **rejected** in favor of this
   durable, Mac-independent hosting. `RPC_LOCAL` (not `RPC_FUJI`) is the var `chain.mjs` reads.
4. **Vercel: deploy the prebuilt static `dist`, not a source-build.** Building locally with
   `dashboard/.env.production` bakes the Render URLs deterministically; uploading source and
   letting Vercel build risks the `.env.production` not being uploaded (it matches `.env.*`).
   The SPA rewrite must **exclude real assets**: `/((?!assets/|window.svg).*) -> /index.html`.
5. **Free-tier liveliness.** Render free tier has **no always-on workers**, so the four
   autonomous drivers run on the local Mac (`demo/run_fuji.sh`). The hosted site is always
   *up* (serves Fuji state), but the auction only *advances* while the Mac drivers run. Free
   web services also cold-start (~30–60 s) after 15 min idle.
6. **Agent randomization is deterministic, not RNG.** `agentBids(epoch)` jitters bids via
   `keccak256("window:bid:"+epoch+":"+salt)`, **not** `Math.random` — reproducible for a
   given epoch (and safe if this ever runs where `Math.random` is unavailable).

## KNOWN DOC DRIFT

Docs that lag the code. The code and this notes/ set win.

**Still drifted — deliberately kept (spike/ is a historical decision record; do not
rewrite it, read it with these caveats):**

1. **spike/NOTES.md references deleted modules**: `elgamal.mjs` and `decryptPCT`
   (spike/NOTES.md:81, :101) and — same drift in **spike/GATE.md** — `gen_pocd_input.mjs`
   (GATE.md:24) and `elgamal.mjs` (GATE.md:33). All removed in commit 8e9db63; replaced
   by `userFromRaw` / `genWithdrawProof` / `decryptEGCT(Direct)` in
   `packages/eerc-node/src/eerc.mjs`.
2. **spike/NOTES.md:101 claims the dashboard uses `@avalabs/eerc-sdk` v1.0.2** —
   `dashboard/package.json` has no such dependency; the browser never got the SDK.
   Live writes go via the Control API (commit 15b508e); browser-side crypto is the
   circomlibjs ElGamal port in the mock adapter.
3. **spike/NOTES.md + spike/GATE.md still describe the 372-signal monolithic PoCD and
   the cast pre-deploy** (over-EIP-170 verifier, `anvil --code-size-limit`,
   `DEPTH_ARRAY_VERIFIER_ADDR`, the "split into bid/ask proofs" deferred plan,
   spike/NOTES.md:83-87) — all superseded by the **implemented** chunked design (4 ×
   102-signal proofs, 17,892-byte verifier, deploys inline, live on Fuji). See the
   resolved EIP-170 entry above.

**Fixed in the pre-submission hardening pass (2026-07-12)** — kept here so the history
of the audit is legible:

- Readme.md refreshed: §0 live-deployment section added; §5 diagram marked superseded
  (Control-API pointer); §9 notes the 0.8.27 toolchain pin; §15 records the implemented
  chunking outcome; all seven `[TO-VERIFY]` markers resolved inline.
- dashboard/README.md: LiveAdapter "writes Pending (EercNotReady)" replaced with the
  real Control-API write path + no-silent-mock-fallback statement; the deleted
  `elgamal.mjs` reference now points at `eerc.mjs`.
- dashboard/.env.example: "@avalabs/eerc-sdk writes" wording replaced (Control API);
  `VITE_CONTROL_URL` added to the template.
- Root `.env.example`: added the hard-required Fuji vars (`WALLET_PRIVATE_KEY`,
  `AGENT4_PK`/`AGENT5_PK`) + `CHAIN_ID`, `START_BLOCK`, `KEEPER_STALL_S`,
  `RENDER_API_KEY`; stale `BABYJUBJUB_ADDR` → `REGISTRAR_ADDR`.
- Script comments: `run_autonomous.sh` "operator + operator" header and
  `run_demo.sh:2` "raised code limit" leftover removed.
- Code (also redeployed): indexer LoanCreated/Funded/Repaid/Seized firehose entries
  now carry the real `epoch` (previously the dashboard's `MatchesPosted` always showed
  epoch 0); all Control API write routes return receipt `gasUsed` (previously a dead
  `undefined` read in `LiveAdapter.tx()`).
