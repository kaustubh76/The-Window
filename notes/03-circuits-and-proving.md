# 03 — Circuits & Proving (`circuits/`, `packages/eerc-node/`)

The two custom Groth16 circuits (CollateralSolvency, DepthCurve PoCD array), the build
pipeline that turns them into the on-chain verifiers described in `02-contracts.md`, and
the Node proving library `packages/eerc-node/src/eerc.mjs` that every service uses (see
`04-services.md`). The eERC circuits themselves (registration/transfer/withdraw/…) are
prebuilt in the submodule — teardown in `spike/NOTES.md`.

## Contents

- [Circuit 1 — collateral_solvency.circom](#circuit-1--collateral_solvencycircom)
- [Circuit 2 — depth_pocd_array.circom (production, chunked)](#circuit-2--depth_pocd_arraycircom-production-chunked)
  - [The 102-signal-per-chunk order coupling with MONIAOracle](#the-102-signal-per-chunk-order-coupling-with-moniaoracle)
  - [depth_pocd.circom — superseded single-sum gate](#depth_pocdcircom--superseded-single-sum-gate)
- [Build scripts & artifacts (`circuits/build/`)](#build-scripts--artifacts-circuitsbuild)
- [eerc.mjs — the proving/crypto API surface](#eercmjs--the-provingcrypto-api-surface)
  - [The two decryption conventions (gotcha)](#the-two-decryption-conventions-gotcha)
- [Support scripts in packages/eerc-node/src/](#support-scripts-in-packageseerc-nodesrc)
- [Where proving runs](#where-proving-runs)

---

## Circuit 1 — collateral_solvency.circom

`circuits/collateral_solvency/collateral_solvency.circom` (circom 2.1.9). The borrower
proves, in zero knowledge, that their encrypted collateral covers the haircut-scaled
encrypted loan size, WITHOUT revealing either amount
(`collateral_solvency.circom:7-17`):

1. `ownerPub == ownerPriv · G` — key binding via eERC's `CheckPublicKey`
   (`collateral_solvency.circom:33-36`).
2. `Dec(ownerPriv, Ccoll) == coll` — the collateral ciphertext decrypts to the private
   witness `coll`, via eERC's `CheckValue` (which wraps `ElGamalDecrypt`)
   (`:39-45`).
3. `Dec(ownerPriv, Cloan) == loan` — same for the loan-size ciphertext (`:48-54`).
4. `coll * 10000 >= loan * h` with `h = 12000` bps (120% haircut), expressed as
   `NOT(collScaled < loanScaled)` using circomlib `LessThan(96)` (range-checked to
   96 bits) with `lt.out === 0` (`:56-66`).

It **reuses eERC's audited templates** — `CheckPublicKey` / `CheckValue` from
`contracts/lib/EncryptedERC/circom/components.circom` and circomlib comparators
(`collateral_solvency.circom:3-5`) — so the in-circuit curve matches the on-chain
BabyJubJub library. Both ciphertexts are eERC EGCTs encrypted **to the borrower's own
key**; `coll`/`loan` are private witnesses the borrower already knows.

**Public signals — 11, in this order** (from
`component main { public [ Ccoll_c1, Ccoll_c2, Cloan_c1, Cloan_c2, h, ownerPub ] }`,
`collateral_solvency.circom:69`):

| # | Signal |
|---|---|
| 0–1 | `Ccoll_c1.x`, `Ccoll_c1.y` |
| 2–3 | `Ccoll_c2.x`, `Ccoll_c2.y` |
| 4–5 | `Cloan_c1.x`, `Cloan_c1.y` |
| 6–7 | `Cloan_c2.x`, `Cloan_c2.y` |
| 8 | `h` (12000) |
| 9–10 | `ownerPub.x`, `ownerPub.y` |

Private: `ownerPriv`, `coll`, `loan` (`:27-30`). This is exactly the `pub[11]` vector
`CollateralVault.lockCollateral` assembles on-chain
(`contracts/src/CollateralVault.sol:85-96`) — the vault pins `pub[8] = HAIRCUT_BPS`, so
a borrower cannot prove against a weaker haircut (the gate test tampering `h` to 11000
fails, `contracts/test/CollateralSolvencyGate.t.sol:53-57`).

## Circuit 2 — depth_pocd_array.circom (production, chunked)

`circuits/depth_pocd/depth_pocd_array.circom`, template `DepthPoCDArray(N)` now
instantiated with **N = 10** (`depth_pocd_array.circom:66`) — one circuit proves a
**10-tick CHUNK** of the depth curve, and the full 37-tick curve is proven as **K = 4
chunks** over tick ranges `[0..9], [10..19], [20..29], [30..36]` (header comment,
`depth_pocd_array.circom:5-26`). Per chunk:

1. `auditorPub == auditorPriv · G` — one `CheckPublicKey` (`:39-42`).
2. For every tick t and side s: `Dec(auditorPriv, C[s][t]) == claimed[s][t]` — two
   `CheckValue` components per tick (20 per chunk) (`:45-63`).

So the administrator still cannot reshape the curve — the **shape** is proven, not just
the totals — and **cross-chunk swaps fail** because each chunk's public signals embed
its own accumulator slice (`:20-22`; tested on-chain, see `02-contracts.md`).

**Why chunked**: the 372-signal monolithic verifier compiled to 62,708 bytes of
deployed code — over EIP-170's 24,576-byte limit — and needed a cast/`--code-size-limit`
deploy hack. The 102-signal chunk verifier is **17,892 bytes** and deploys inline on
any chain, including Fuji (`:16-18`).

**Padding**: the last chunk pads virtual ticks 37–39 with the identity point `(0,1)`
and claim 0, which verifies trivially (`Dec(identity) = identity = 0·G`) — exactly like
empty on-chain ticks, which `getAggregate` also reads as `(0,1)`
(`contracts/src/AuctionHouse.sol:144`). `MONIAOracle._buildChunkSignals` writes the
same padding without touching AuctionHouse, so prover and contract agree by
construction.

Inputs: public `auditorPub[2], askC1[N][2], askC2[N][2], askSum[N], bidC1[N][2],
bidC2[N][2], bidSum[N]`; private `auditorPriv` (`depth_pocd_array.circom:28-36`).
~151k constraints per chunk — the 2^20 ptau is reused
(`circuits/build_pocd_array.sh:2-3`).

### The 102-signal-per-chunk order coupling with MONIAOracle

**This is the single most load-bearing ordering contract in the repo.** The circuit's
`public [...]` list flattens arrays **grouped** (all of `askC1`, then all of `askC2`,
…), NOT interleaved per tick:

```circom
component main { public [ auditorPub, askC1, askC2, askSum, bidC1, bidC2, bidSum ] } = DepthPoCDArray(10);
                                                    // depth_pocd_array.circom:66
```

`MONIAOracle._buildChunkSignals(epoch, depth, k)` reproduces exactly that order from
on-chain state for the chunk's tick slice `k*10 .. k*10+9`
(`contracts/src/MONIAOracle.sol:158-226`; layout comment at `:148-157`):

| Index range | Circuit signal | Oracle source (t = k·10 … k·10+9) |
|---|---|---|
| 0–1 | `auditorPub[2]` | immutables `auditorPubX/Y` (`MONIAOracle.sol:166-167`) |
| 2–21 | `askC1[10][2]` (x,y per tick) | `getAggregate(epoch, ASK, t).c1` (`:172-182`) |
| 22–41 | `askC2[10][2]` | `getAggregate(epoch, ASK, t).c2` (`:183-193`) |
| 42–51 | `askSum[10]` | `depth[t].askSum` — admin-claimed, proof-checked (`:194-197`) |
| 52–71 | `bidC1[10][2]` | `getAggregate(epoch, BID, t).c1` (`:199-209`) |
| 72–91 | `bidC2[10][2]` | `getAggregate(epoch, BID, t).c2` (`:210-220`) |
| 92–101 | `bidSum[10]` | `depth[t].bidSum` (`:221-224`) |

Total = 2 + 10×10 = **102 per chunk** (4 chunks per print). Ticks `>= 37` (last chunk)
are written as `(0,1)`/`(0,1)`/0 without calling `getAggregate`. The
`PoCDVerifierAdapter` hard-rejects any other length
(`contracts/src/verifiers/PoCDVerifierAdapter.sol:35`). If either side of this pairing
is ever reordered (circuit `public [...]` order, or the oracle's loop order), proofs
verify off-chain but `postPrint` reverts `BadProof` on-chain — see
`07-decisions-and-gotchas.md`. `MONIAOracleArrayIntegration.t.sol` is the regression
guard: real chunk proofs pass only because each chunk's on-chain accumulator slice
equals that chunk's 102 signals bit-for-bit, and swapping two valid chunk proofs
reverts (`contracts/test/MONIAOracleArrayIntegration.t.sol:54-99`).

### depth_pocd.circom — superseded single-sum gate

`circuits/depth_pocd/depth_pocd.circom`, template `DepthPoCDSingle` — the D2 gate
version proving one accumulator decryption (`Dec(auditorPriv, Csum) == claimedSum`),
7 public signals `[Csum_c1(2), Csum_c2(2), claimedSum, auditorPub(2)]`
(`depth_pocd.circom:45`). It is the array circuit's inner constraint instantiated once
(`:16-18`). **Superseded by the array circuit for production**; its generated verifier
`contracts/src/verifiers/DepthPoCDVerifier.sol` and `DepthPoCDGate.t.sol` remain as
gate artifacts and are not wired into deployment.

## Build scripts & artifacts (`circuits/build/`)

All three scripts compile with
`-l contracts/lib/EncryptedERC/circom` so `include "components.circom"` resolves to the
submodule's audited templates, and export Solidity verifiers via
`snarkjs zkey export solidityverifier`.

| Script | Circuit | ptau | Key outputs in `circuits/build/` | Verifier exported to |
|---|---|---|---|---|
| `build_solvency.sh` | collateral_solvency | reuses `pot15_final.ptau` (2^15) | `collateral_solvency.r1cs`, `collateral_solvency_js/collateral_solvency.wasm`, `solvency_0.zkey` → `solvency_final.zkey`, `solvency_vkey.json`, `solvency_input.json` → `solvency_witness.wtns` → `solvency_proof.json`/`solvency_public.json`, `solvency_calldata.txt` | `contracts/src/verifiers/CollateralSolvencyVerifier.sol` |
| `build_pocd_gate.sh` | depth_pocd (single-sum, superseded) | **generates** `pot15_0/1/final.ptau` (powersoftau new bn128 15 + contribute + prepare phase2) | `depth_pocd.r1cs`, `depth_pocd_js/`, `depth_pocd_final.zkey`, `depth_pocd_vkey.json`, `pocd_input.json` → `witness.wtns` → `proof.json`/`public.json`, `calldata.txt` | `contracts/src/verifiers/DepthPoCDVerifier.sol` |
| `build_pocd_array.sh` | depth_pocd_array (**chunked**: N=10 ticks/chunk, K=4 chunks, ~151k constraints/chunk) | requires pre-downloaded `powersOfTau28_hez_final_20.ptau` (2^20, reused) — errors out if missing | `depth_pocd_array.r1cs`, `depth_pocd_array_js/depth_pocd_array.wasm`, `depth_array_final.zkey`, `depth_array_vkey.json`; smoke prove over **chunk 0** of the fixture scenario: `pocd_array_input.json` → `depth_array_witness.wtns` → `depth_array_proof.json`/`depth_array_publicsig.json`, `depth_array_calldata.txt` | `contracts/src/verifiers/DepthPoCDArrayVerifier.sol` (102-signal chunk verifier) |

Each script runs the full loop: compile → groth16 setup → `zkey contribute` (single dev
contribution — NOT a production ceremony) → export vkey → export Solidity verifier →
witness → prove → off-chain `groth16 verify` → `soliditycalldata`.

Two post-export quirks:

- `build_pocd_array.sh` renames the generated contract:
  `perl -pi -e 's/contract Groth16Verifier/contract DepthPoCDArrayVerifier/'` — the
  single-sum verifier still carries the stock `Groth16Verifier` name, so without the
  rename the two would collide in Foundry's flat namespace.
- The exported chunk verifier's deployed bytecode is **17,892 bytes — under EIP-170**
  (the 372-signal monolith was 62,708 bytes), so it deploys inline via `DeployAll`
  like any other contract; the old cast pre-deploy / `--code-size-limit` machinery is
  gone (see `02-contracts.md` → Verifier layer).

The services and `genSolvencyProof`/`genDepthArrayProof` consume the **build dir
artifacts directly** (wasm + final zkey); the dashboard never does (see
[Where proving runs](#where-proving-runs)).

## eerc.mjs — the proving/crypto API surface

`packages/eerc-node/src/eerc.mjs` — the single crypto module, mirroring
ava-labs/EncryptedERC conventions (`test/user.ts`, `src/poseidon`, `src/jub`) using the
SAME libraries (`@zk-kit/baby-jubjub`, `maci-crypto`, `poseidon-lite`, `snarkjs`) so
proofs/ciphertexts are accepted by the deployed contracts (`eerc.mjs:1-15`).

> Post-refactor note (commit `8e9db63`): `elgamal.mjs`, `gen_pocd_input.mjs` and
> `decryptPCT` were **dropped**. Everything below is the current, complete surface —
> do not reintroduce references to the removed modules.

**Constants / artifact pointers**:

| Export | Where | What |
|---|---|---|
| `ART` | `eerc.mjs:20-33` | prebuilt eERC circuit artifacts in `contracts/lib/EncryptedERC/circom/build/`: `registration/{registration.wasm, circuit_final.zkey}`, `withdraw/{withdraw.wasm, circuit_final.zkey}`, `transfer/{transfer.wasm, transfer.zkey}` |
| `BASE_POINT_ORDER` | `eerc.mjs:35` | re-export of BabyJubJub `subOrder` |
| `POCD_CHUNK_TICKS = 10`, `POCD_CHUNKS = 4` | `eerc.mjs:41-42` | chunking parameters for the DepthCurve PoCD — **must match `MONIAOracle.CHUNK_TICKS`/`CHUNKS` and the circuit's N** (comment at `:37-40`). (The old stale `ARRAY_ART` export was deleted in the submission-hardening pass — `genDepthArrayProof` takes an explicit `buildDir`.) |

**Key/user management**:

| Function | Where | What |
|---|---|---|
| `genUser()` | `eerc.mjs:90-95` | random eERC user: `{privateKey, formattedPrivateKey (= formatPrivKeyForBabyJub(priv) % subOrder), publicKey (= formatted·Base8)}` |
| `userFromRaw(rawPriv)` | `eerc.mjs:99-104` | deterministic user from a raw scalar — lets services reconstruct an actor's BJJ key later (e.g. to decrypt their eERC balance); used with `actors.mjs` `bjjRaw` (see `04-services.md`) |
| `registrationHash(chainId, formattedPrivateKey, eoaAddress)` | `eerc.mjs:106-108` | `poseidon3([chainId, fpk, eoa])` |
| `randomNonce()` | `eerc.mjs:85-87` | 128-bit random + 1 for Poseidon encryption |

**Encryption / decryption**:

| Function | Where | What |
|---|---|---|
| `encryptMessage(publicKey, message, random?)` | `eerc.mjs:111-119` | ElGamal to a point: `c1 = r·G`, `c2 = m·G + r·pk`; returns `{cipher: [c1, c2], random}`. Passing `random = 1n` gives the deterministic encryption matching on-chain `BabyJubJub.encrypt` (hardcoded r=1 — `spike/NOTES.md` Q6) |
| `decryptPoint(privateKey, c1, c2)` | `eerc.mjs:121-126` | `M = c2 − formatPrivKeyForBabyJub(priv)·c1` (User convention) |
| `processPoseidonEncryption(inputs, publicKey)` | `eerc.mjs:129-137` | Poseidon ciphertext (PCT) `{ciphertext, nonce, encRandom, authKey}` — used for deposit `amountPCT` and transfer/withdraw auditor/receiver PCTs |
| `bsgs(M, maxUnits = 1<<22)` | `eerc.mjs:147-164` | baby-step giant-step discrete log to recover the scalar from `m·G` |
| `decryptEGCT(privateKey, eGCT, maxUnits?)` | `eerc.mjs:168-173` | decrypt an eERC balance eGCT `{c1:{x,y}, c2:{x,y}}` to a scalar — **applies `formatPrivKeyForBabyJub` (User convention)** |
| `decryptEGCTDirect(scalar, eGCT, maxUnits?)` | `eerc.mjs:179-187` | decrypt using the scalar **directly** (`M = c2 − (scalar % subOrder)·c1`) — the auction/PoCD **auditor convention** |

**Proof generation** (all snarkjs `groth16.fullProve` + `formatProof`):

| Function | Where | Circuit / artifacts | Notes |
|---|---|---|---|
| `genRegistrationProof(user, eoaAddress, chainId)` | `eerc.mjs:285-298` | eERC registration (`ART.registration`) | returns `{a,b,c,publicSignals,registrationHash}` for `Registrar.register` |
| `genTransferProof(sender, senderBalance, receiverPublicKey, transferAmount, senderEncryptedBalance, auditorPublicKey)` | `eerc.mjs:191-231` | eERC transfer (`ART.transfer`) | mirrors the submodule's `privateTransfer` helper; builds sender/receiver VTT ciphertexts + receiver/auditor/sender PCTs; also returns `senderBalancePCT` |
| `genWithdrawProof(user, amount, senderBalance, senderEncryptedBalance, auditorPub)` | `eerc.mjs:263-283` | eERC withdraw (`ART.withdraw`) | added in the 8e9db63 refactor; returns `{a,b,c,publicSignals,balancePCT}` |
| `genSolvencyProof(buildDir, ownerScalar, coll, loan)` | `eerc.mjs:233-258` | CollateralSolvency (`{buildDir}/collateral_solvency_js/*.wasm`, `{buildDir}/solvency_final.zkey`) | **direct-scalar convention**: `ownerPub = (ownerScalar % subOrder)·Base8`; encrypts coll/loan to the owner's own key with deterministic nonce `1n`; hardcodes `h = 12000`; returns `{a,b,c, cColl, cLoan, ownerPub}` in the exact shapes `CollateralVault.lockCollateral` wants |
| `genDepthArrayProof(buildDir, auditorPriv, auditorPub, askAgg, bidAgg, askSum, bidSum)` | `eerc.mjs:54-83` | DepthPoCDArray chunks (`{buildDir}/depth_pocd_array_js/depth_pocd_array.wasm`, `{buildDir}/depth_array_final.zkey`) | **signature unchanged, now chunked internally**: takes the 37-element aggregate arrays exactly as read from `getAggregate` plus the BSGS-decrypted sums, pads them to 40 ticks with the identity aggregate `{c1:(0,1), c2:(0,1)}` and sum 0 (`:59-63`, identical to `MONIAOracle._buildChunkSignals`), then proves the 4 chunks **sequentially** (`:67-81`). Returns **`{ proofs: [{a,b,c,publicSignals} × 4] }`** — callers pass `proofs.map(p => ({a: p.a, b: p.b, c: p.c}))` to `postPrint`. Measured: ~30s for all 4 chunks (the 372-signal monolith took ~40s). The admin service's print path |
| `formatProof(proof, publicSignals)` | `eerc.mjs:140-144` | — | snarkjs proof → Solidity `(a, b, c, publicSignals)` via `exportSolidityCallData` (handles the G2 coordinate swap) |

### The two decryption conventions (gotcha)

There are **two distinct private-key conventions** in play, and mixing them silently
produces garbage decryptions (BSGS throws "not found"):

1. **User convention (eERC balances)** — eERC derives the effective scalar as
   `formatPrivKeyForBabyJub(privateKey) % subOrder` (a blake-hash-based pruning, as in
   maci-crypto). `genUser`/`userFromRaw` store both forms; `decryptPoint` and
   **`decryptEGCT`** apply `formatPrivKeyForBabyJub` internally (`eerc.mjs:121-126`,
   `:168-173`). Use for anything encrypted by the eERC contracts (wrapped balances,
   transfer outputs).
2. **Auditor/direct convention (auction + PoCD + solvency)** — agents encrypt bid sizes
   with `encryptMessage(pub, size)` where `pub = scalar·G` for a **raw scalar**, and
   the circuits consume that raw scalar as `auditorPriv`/`ownerPriv`. Decryption must
   therefore use **`decryptEGCTDirect`** (no formatting; `eerc.mjs:179-187`), and
   `genDepthArrayProof`/`genSolvencyProof` take the raw scalar. The comment at
   `eerc.mjs:175-178` and `check_auditor_consistency.mjs` pin this down;
   `MONIAOracleArrayIntegration.t.sol` uses the raw fixture scalar the same way.

Rule of thumb: **eERC contract state ⇒ `decryptEGCT`; AuctionHouse accumulators /
custom-circuit ciphertexts ⇒ `decryptEGCTDirect`.** Cross-reference
`07-decisions-and-gotchas.md`.

## Support scripts in packages/eerc-node/src/

| Script | What it does |
|---|---|
| `register_all.mjs` | F2 post-deploy bootstrap: adds all bidding actors (`MEMBER_NAMES` from `services/lib/actors.mjs`) to `MemberRegistry` (`register_all.mjs:26-31`); registers the admin in eERC with its deterministic BJJ key (`userFromRaw(ACTORS.admin.bjjRaw)` + `genRegistrationProof`) and calls `eerc.setAuditorPublicKey(admin)` — non-fatal on failure (`:35-48`); writes `dashboard/.env` with `VITE_ADAPTER=live`, chain/indexer/control URLs and all contract addresses from `contracts/deployments/<chainid>.json` (`:51-71`) |
| `gen_keys.mjs` | generates THROWAWAY test keys (Fuji only): 6 EOA PKs (`LENDER1, LENDER2, BORROWER, ADMIN, KEEPER, VAULT_OPERATOR`) + an auditor BJJ keypair (`AUDITOR_BJJ_PRIV/PUB_X/PUB_Y`), written to the gitignored repo-root `.env` |
| `gen_solvency_input.mjs` | writes `circuits/build/solvency_input.json` for the gate witness: coll 6000 / loan 5000 (exactly 120% of the h=12000 haircut), fresh `genUser`, both ciphertexts encrypted to the user's own key |
| `gen_pocd_array_input.mjs` | emits the **chunked** witness inputs: `circuits/build/pocd_array_input_k{0..3}.json` (+ matching `*_public.json`, **102 signals each** in the grouped order), plus the legacy name `pocd_array_input.json` (= chunk 0, used by `build_pocd_array.sh`'s smoke prove). Scenario: ask 300 @ tick 4, bid 300 @ tick 10, all other ticks identity `(0,1)`/0, virtual ticks 37–39 padded the same way; active ticks use deterministic nonce `r=1` to match on-chain `BabyJubJub.encrypt`; auditor scalar `2748579834902348905823409582340958234` (must equal `FIXTURE_PRIV` in `MONIAOracleArrayIntegration.t.sol`) |
| `emit_array_fixture.mjs` | **self-proves the fixture scenario** (ask 300 @ tick 4, bid 300 @ tick 10, nonce r=1) via `genDepthArrayProof` and writes the Foundry-parseable `contracts/test/fixtures/depth_chunks.json` (`{chunks: [{a, b0, b1, c, pub[102]} × 4]}`) consumed by the gate + integration tests. The old single-proof `depth_array.json` fixture is deleted |
| `e2e_register_wrap.mjs` | D1 e2e against deployed local stack: register admin/A/B in eERC → set auditor → mint+approve+`deposit` (wrap) 5000 tUSDC for A → encrypted `transfer` A→B of 2000 → `decryptEGCT` both balances and assert 2000/3000 |
| `check_registration.mjs` | offline sanity: `genRegistrationProof` with prebuilt artifacts, verify against the shipped `registration_verification_key.json` |
| `check_verifier_onchain.mjs` | isolates `InvalidProof`: calls the deployed `RegistrationCircuitGroth16Verifier` directly with a fresh proof |
| `check_auditor_consistency.mjs` | F1 gate for the two-convention story: encrypt 120 + 230 to `pub = S·G`, homomorphic-add, assert `decryptEGCTDirect(S, sum) == 350`, then `genDepthArrayProof` over a 37-tick depth with that aggregate at ask tick 4 and verify **each of the 4 chunk proofs** off-chain against the 102-signal `depth_array_vkey.json` |

## Where proving runs

**All proving is server-side (Node).** The services (`services/` — admin, agents,
operator; see `04-services.md`) import `packages/eerc-node/src/eerc.mjs` and read the
circuit artifacts from disk: eERC proofs from the submodule's prebuilt
`contracts/lib/EncryptedERC/circom/build/`, WINDOW proofs from `circuits/build/`
(wasm + `*_final.zkey`). The auditor private scalar and all actor keys likewise live
only in service-side env/config (`services/lib/actors.mjs`, root `.env`).

The browser dashboard (`05-dashboard.md`) never holds circuits, zkeys, or private
keys — it talks to the indexer (reads) and the control API (writes), which do any
proving on the server. This is deliberate: the 2^20 array zkey alone is far too large
for a browser, and shipping the auditor scalar to a client would break the whole
PoCD trust story.
