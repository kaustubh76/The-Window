# 06 — Demo & Ops (`demo/`, `scripts/`, `Makefile`, env)

How THE WINDOW is actually launched, demoed, verified, and configured — locally on
Anvil and **live on Avalanche Fuji (43113)**. The services being started here are
described in `04-services.md`; the contracts they drive in `02-contracts.md`; the
proving artifacts they need in `03-circuits-and-proving.md`; the dashboard they feed in
`05-dashboard.md`. Decisions/gotchas behind several of the oddities below (chunked
PoCD / EIP-170 history, auditor conventions, doc drift) are consolidated in
`07-decisions-and-gotchas.md`.

## Contents

- [The demo entrypoints at a glance](#the-demo-entrypoints-at-a-glance)
- [`demo/run_demo.sh` — scripted demo](#demorun_demosh--scripted-demo)
- [`demo/run_autonomous.sh` — autonomous demo](#demorun_autonomoussh--autonomous-demo)
- [`demo/scenario.mjs` — the deterministic 2-epoch scenario](#demoscenariomjs--the-deterministic-2-epoch-scenario)
- [`demo/verify_backend.mjs` — assertion harness](#demoverify_backendmjs--assertion-harness)
- [`demo/smoke_member.mjs` — member eERC smoke](#demosmoke_membermjs--member-eerc-smoke)
- [`scripts/deploy_local.sh` — local deploy (vanilla Anvil)](#scriptsdeploy_localsh--local-deploy-vanilla-anvil)
- [Fuji deployment (LIVE, chainId 43113)](#fuji-deployment-live-chainid-43113)
- [Makefile targets](#makefile-targets)
- [PROFILE plumbing end-to-end](#profile-plumbing-end-to-end)
- [Environment variable reference](#environment-variable-reference)
- [How to run everything](#how-to-run-everything)

---

## The demo entrypoints at a glance

| | `demo/run_demo.sh` | `demo/run_autonomous.sh` | `demo/run_fuji.sh` |
|---|---|---|---|
| Chain | fresh vanilla Anvil `--silent` (run_demo.sh:30) — **no `--code-size-limit` anymore**: the chunked PoCD verifier fits EIP-170 | fresh vanilla Anvil `--silent --block-time 1` (run_autonomous.sh:30) | **Avalanche Fuji** — no anvil at all; requires a prior `deploy_fuji.sh` (run_fuji.sh:25) |
| Time model | script-driven `evm_increaseTime` + `evm_mine` / `anvil_mine` | real interval mining (1 block/s) so `block.timestamp` advances on its own | real chain time (~2s blocks) |
| Services started | indexer + control only (run_demo.sh:43-44) | ALL SIX: indexer, control, keeper, agents, operator, admin (run_autonomous.sh:37-42) | ALL SIX, against Fuji (run_fuji.sh:41-46) |
| Market driver | `demo/scenario.mjs` (run_demo.sh:48) | none — the daemons drive everything | none — the daemons drive everything |
| EPOCH_LEN / TENOR_BLOCKS | 60 / 10 (run_demo.sh:11) | 10 / 5 (run_autonomous.sh:10) | 120 / 60 defaults (run_fuji.sh:22) |

Both scripts `pkill` any previous anvil/services, launch a fresh Anvil, run
`scripts/deploy_local.sh`, then `node packages/eerc-node/src/register_all.mjs`, and log
everything to `/tmp/window_*.log` (anvil, deploy, indexer, control, and in the
autonomous case keeper/agents/operator/admin too).

## `demo/run_demo.sh` — scripted demo

One-command local demo (also `make demo`). Pipeline (run_demo.sh:25-48):

1. **`[1/5]` fresh Anvil** — kill old anvil/indexer, then plain `anvil --silent`
   (run_demo.sh:30). The old `--code-size-limit 200000` flag is **gone**: the chunked
   102-signal `DepthPoCDArrayVerifier` is 17,892 bytes, under EIP-170 (see
   `07-decisions-and-gotchas.md`). (The step's echo string still says "raised code
   limit" — cosmetic leftover, run_demo.sh:25.)
2. **`[2/5]` deploy** — `bash scripts/deploy_local.sh` (run_demo.sh:34), output to
   `/tmp/window_deploy.log`.
3. **`[3/5]` register** — `node packages/eerc-node/src/register_all.mjs`
   (run_demo.sh:38): adds every bidding actor to `MemberRegistry`, registers the admin
   in eERC + sets the eERC auditor, and writes `dashboard/.env` (register_all.mjs:25-71).
4. **`[4/5]` indexer + control** — from `services/`:
   `node indexer/index.mjs` and `CONTROL_PORT=8899 node control/index.mjs`
   (run_demo.sh:43-44).
5. **`[5/5]` scenario** — `node demo/scenario.mjs` (run_demo.sh:48), real proofs, ~2 min.

Environment it exports (run_demo.sh:11-23):

- `RPC_LOCAL=http://127.0.0.1:8545 CHAIN_ID=31337 EPOCH_LEN=60 TENOR_BLOCKS=10 INDEXER_PORT=8787 PROFILE=DEMO`
- Actor keys = **Anvil's default pre-funded accounts** #0–#5:
  `ADMIN_PK` (#0), `KEEPER_PK` (#1), `VAULT_OPERATOR_PK` (#2), `LENDER1_PK` (#3),
  `LENDER2_PK` (#4), `BORROWER_PK` (#5) — same mapping as `services/lib/actors.mjs:7-15`.
  `KEEPER_ADDR` / `VAULT_OPERATOR_ADDR` derived via `cast wallet address` (run_demo.sh:18-19).
- Demo auditor scalar `AUDITOR_BJJ_PRIV=2748579834902348905823409582340958234` with its
  public point `AUDITOR_BJJ_PUB_X/Y` (pub = S·G, run_demo.sh:20-23). These are also the
  hard fallbacks in `services/lib/actors.mjs:60-65` and `demo/scenario.mjs:17-21`.

It ends with the follow-ups printed on run_demo.sh:51-53: start the dashboard
(`cd dashboard && npm run dev`, live adapter already configured by `register_all.mjs`),
query the indexer (`curl http://127.0.0.1:8787/monia/latest`), and optionally run the
keeper/agents/admin services for the unattended story.

## `demo/run_autonomous.sh` — autonomous demo

"Autonomous" = **no scenario script**. The six services drive the whole market and loan
lifecycle unattended: keeper opens/closes epochs on the clock and seizes past-deadline
loans, agents submit encrypted bids each Open epoch, admin prints M-ONIA with a real
chunked PoCD (4 × 10-tick proofs), posts matches, then drives each loan
(lock → operator confirm → fund → repay-most / default-one), operator confirms lock
requests (headers of `services/{keeper,agents,admin,operator}/index.mjs`; the admin
loop is `services/admin/index.mjs:1-5`).

Pipeline (run_autonomous.sh:25-44):

1. Kill old processes; `anvil --silent --block-time 1` (no code-size flag needed
   anymore) — interval mining so `block.timestamp` advances for the time-based keeper
   (comment at run_autonomous.sh:28-29; the scripted demo instead uses `evm_increaseTime`).
2. `bash scripts/deploy_local.sh` and `node packages/eerc-node/src/register_all.mjs`.
3. Start **all six** services from `services/`, each backgrounded with a log:
   `indexer`, `control`, `keeper`, `agents`, `operator`, `admin`
   (run_autonomous.sh:37-42), then `wait`.

Environment (run_autonomous.sh:10-23): same Anvil actor keys and demo auditor scalar as
`run_demo.sh` — exported explicitly *so the root `.env`'s Fuji keys don't override*
(comment at run_autonomous.sh:12) — plus the fast-cycle knobs:

```
EPOCH_LEN=10 TENOR_BLOCKS=5 PROFILE=DEMO CONTROL_PORT=8899 INDEXER_PORT=8787
KEEPER_STALL_S=45 ADMIN_POLL_MS=3000 KEEPER_POLL_MS=2000 AGENTS_POLL_MS=2000 OPERATOR_POLL_MS=2000
```

`KEEPER_STALL_S` is the keeper's liveness stall-guard: if an epoch stays Closed without
a print for that many seconds (admin down / print reverted), the keeper opens the next
epoch anyway so the loop never wedges (`services/keeper/index.mjs:10,27-37`; default 120s
when unset).

Watch it: `tail -f /tmp/window_admin.log` (run_autonomous.sh:43).

## `demo/scenario.mjs` — the deterministic 2-epoch scenario

Deterministic full-epoch demo against the live Anvil stack with **REAL proofs**
(scenario.mjs:1-5). Uses `handles()` from `services/lib/chain.mjs` and
`encryptMessage` / `decryptEGCTDirect` / `genDepthArrayProof` / `genSolvencyProof` from
`packages/eerc-node/src/eerc.mjs` (scenario.mjs:8-11).

- **Epoch 1 — borrow → print → repay** (scenario.mjs:94-105): keeper `openEpoch()`;
  lender1 `submitAsk(4, Enc(300))` and borrower `submitBid(10, Enc(300))` (sizes are
  real ElGamal ciphertexts to the auditor pub, scenario.mjs:35-38);
  `advanceAndClose()` reads `epochLength()` from chain (honors the profile) and does
  `evm_increaseTime(epochLen+1)` + `evm_mine` + `closeEpoch()` (scenario.mjs:42-47);
  `adminPrint()` decrypts all 37 ask/bid aggregates with `decryptEGCTDirect(S, …)`,
  mirrors on-chain `_computeClearing`, generates the chunked PoCD — 4 × 10-tick
  proofs, ~30s total (scenario.mjs:65-67) — and calls `oracle.postPrint(epoch, rStar,
  depth, proofs.map(p => ({a,b,c})))` (scenario.mjs:69-72); then `postMatches`, borrower
  `lockCollateral` with a real solvency proof (6000 ≥ 1.2×5000, scenario.mjs:83-85),
  operator `confirmLock`, admin `confirmFunding`, admin `repay`.
- **Epoch 2 — borrow → default → seize** (scenario.mjs:107-121): same up to funding
  with lender2, then `anvil_mine` `tenorBlocks+1` blocks past the deadline
  (scenario.mjs:117-118) and keeper `seize(loanB)`.

Ends by printing both loans' final states (expect `Repaid` and `Defaulted`,
scenario.mjs:123-125).

## `demo/verify_backend.mjs` — assertion harness

Deterministic verification of the ops backend (`services/lib/adminops.mjs` +
`memberops.mjs` + operator flow) against a live Anvil deploy — drives a full epoch +
**both** loan paths with explicit time/block control, **no long-running services**
(verify_backend.mjs:1-3). Every step is asserted and any failure exits non-zero
(`process.exit(1)`, verify_backend.mjs:71):

- Repay path: open/bid/close (crossing bids 300@4 vs 300@10 → r\*=tick 4,
  verify_backend.mjs:18-20) → `admin.printEpoch` (real PoCD) → `admin.matchEpoch` →
  lock + operator `confirmLock` + `admin.confirmFunding` → assert state `Active` →
  `admin.repay` → assert `Repaid` (verify_backend.mjs:29-53).
- `REPAY_ONLY=1` stops here with "PASS" (verify_backend.mjs:54) — useful for a quick check.
- Seize path: fresh epoch/loan, fund but don't repay, `anvil_mine` past
  `tenorBlocks`, keeper `seize`, assert `Defaulted` (verify_backend.mjs:57-67).

## `demo/smoke_member.mjs` — member eERC smoke

Fast smoke of the member eERC ops, **no PoCD** (smoke_member.mjs:1):
`registerMember("lender1")` → `faucet(10000)` → `wrap(5000)` → decrypt balance, assert
`5000` → `unwrap(2000)` → assert `3000` (smoke_member.mjs:8-19). This exercises exactly
what the dashboard "register / wrap / unwrap" buttons trigger via the Control API.
Exits non-zero on mismatch.

## `scripts/deploy_local.sh` — local deploy (vanilla Anvil)

Deploys the full stack to a running **vanilla** Anvil — "no code-size hacks needed: the
chunked 102-signal DepthPoCDArrayVerifier is ~18KB, under EIP-170"
(deploy_local.sh:1-3). The old flow (cast pre-deploy of the ~62KB monolith verifier +
`DEPTH_ARRAY_VERIFIER_ADDR` env + `--skip-simulation`) is **gone**. Steps:

1. `forge build -q` (deploy_local.sh:18).
2. One `forge script script/DeployAll.s.sol --rpc-url … --broadcast` with
   `USE_REAL_VERIFIERS=1` (deploy_local.sh:21-26). `DeployAll` deploys the chunk
   verifier **inline** and wraps it in the small `PoCDVerifierAdapter`
   (DeployAll.s.sol:74-77).
3. Prints `contracts/deployments/<chainid>.json` (deploy_local.sh:28-29) — `DeployAll`
   writes it via `vm.writeFile` (DeployAll.s.sol:98-112). All services and
   `register_all.mjs` read addresses from this file (`services/lib/chain.mjs:18-20`).

Notes:

- It deliberately does **not** source the root `.env` (would override the demo auditor
  key/tenor — comment at deploy_local.sh:10-11). Standalone use relies on the ambient
  env + defaults.
- Standalone defaults differ from the demo: `EPOCH_LEN` defaults to 60 but
  `TENOR_BLOCKS` defaults to **150** (deploy_local.sh:22), whereas `run_demo.sh`
  exports `TENOR_BLOCKS=10`.
- `DeployAll` also deploys the whole eERC converter stack (TestUSDC 6-decimals,
  regenerated eERC verifiers, Registrar, `EncryptedERC` converter with `decimals: 6`)
  and the five WINDOW contracts, then does the one-time wiring
  `auction.setOracle` / `vault.setLoanBook` (DeployAll.s.sol:46-89). With
  `USE_REAL_VERIFIERS` unset it falls back to `MockVerifier` for PoCD + solvency
  (DeployAll.s.sol:78-81).
- The chunked flow was verified e2e on a vanilla Anvil (no code-size flag):
  `deploy_local.sh` + `register_all.mjs` + `demo/verify_backend.mjs` → PASS, both the
  repay and the default→seize paths, with real proofs.

## Fuji deployment (LIVE, chainId 43113)

THE WINDOW is **deployed and running on Avalanche Fuji** — made possible by the chunked
PoCD verifier fitting EIP-170 (real networks enforce it; the monolith never could
deploy there). Three scripts, run in this order:

### 1. `scripts/fund_fuji.mjs` — gas-fund the actors

Idempotent funding of all **8 actor EOAs** from the faucet wallet
`WALLET_PRIVATE_KEY` in root `.env` (fund_fuji.mjs:1-4, 18-19): tops each actor up to
its target AVAX balance and skips it if already there (targets: admin 0.5 — it deploys
the stack and prints every epoch — keeper 0.1, operator/lenders/borrower/agent4/agent5
0.05 each, fund_fuji.mjs:22-32). Aborts if any `*_PK` is missing from `.env`. Run:
`cd services && node ../scripts/fund_fuji.mjs`.

### 2. `scripts/deploy_fuji.sh` — deploy the stack

Unlike `deploy_local.sh`, it **sources the root `.env`** (deploy_fuji.sh:11) and
**requires real keys**: `ADMIN_PK`, `KEEPER_PK`, `VAULT_OPERATOR_PK`,
`AUDITOR_BJJ_PUB_X/Y` (hard `:?` guards, deploy_fuji.sh:14-18). Runs the same
`DeployAll.s.sol` with `USE_REAL_VERIFIERS=1`, `--broadcast --slow` against
`RPC_FUJI` (default `https://api.avax-test.network/ext/bc/C/rpc`), with Fuji timing
defaults **`EPOCH_LEN=120` / `TENOR_BLOCKS=60`** (deploy_fuji.sh:30-35). Writes
`contracts/deployments/43113.json` via `block.chainid`. No code-size hacks
(deploy_fuji.sh:2-3).

Then register: `CHAIN_ID=43113 node packages/eerc-node/src/register_all.mjs` —
**registration proofs are chain-id-bound** (`registrationHash(chainId, …)`), so members
must be (re-)registered specifically against 43113. When `CHAIN_ID === 43113`,
`register_all.mjs` also writes `VITE_RPC_FUJI` into `dashboard/.env`
(register_all.mjs:56-57).

### 3. `demo/run_fuji.sh` — run the stack against Fuji

No anvil, no scenario script (run_fuji.sh:1-5). Sources root `.env` (real Fuji
throwaway keys — the opposite of `run_autonomous.sh`, which explicitly overrides with
Anvil keys, run_fuji.sh:15-17), exports `RPC_LOCAL=$RPC_FUJI` (**`RPC_LOCAL` is the
var services actually read** — chain.mjs:14), `CHAIN_ID=43113`, `PROFILE=DEMO`,
`EPOCH_LEN=120 TENOR_BLOCKS=60 KEEPER_STALL_S=300`, and 5s poll intervals for all
daemons (run_fuji.sh:19-23). Guards: `deployments/43113.json` must exist, all 8 actor
PKs + `AUDITOR_BJJ_PRIV` must be set, and every actor must have a nonzero AVAX balance
(run_fuji.sh:25-36). Then starts **all six services** against Fuji, logging to
`/tmp/window_fuji_*.log` (run_fuji.sh:41-47; watch `tail -f /tmp/window_fuji_admin.log`).

Live status: the keeper opened epoch 1 and the agents bid successfully on Fuji (live as
of this writing, 2026-07-11).

### Fuji timing notes

- **`EPOCH_LEN=120`** — the epoch window must outlast chunked-PoCD proving (~30s for
  the 4 chunks) plus real transaction confirmations (comment at run_fuji.sh:21).
- **`TENOR_BLOCKS=60`** — Fuji's ~2s blocks make that a ~2-minute loan tenor; there is
  no `anvil_mine` shortcut, defaults must be real-time-sized.
- **`KEEPER_STALL_S=300`** — the stall-guard needs headroom for slow prints before the
  keeper force-opens the next epoch.

### Fuji addresses — `contracts/deployments/43113.json`

| Contract | Address |
|---|---|
| TESTUSDC | `0x69FeBF0674ffea0ddf6BbFaD554582d9e5DB0bCF` |
| EERC | `0xa3F9e88dfFd25ceb64dc040498c9F2Ce50f8C0a2` |
| REGISTRAR | `0x6603f2485B9B5d8c705400abF7241D4f9e183bF9` |
| MEMBER_REGISTRY | `0x14c8173279FB3F28B6fE9b0423Ff535C0cBaD7F8` |
| AUCTION_HOUSE | `0xd001d287d7e62fE1118C42E49E3fe461e010a71e` |
| MONIA_ORACLE | `0xD1979c145d70009e6D84AB82A590E13a0026CEc2` |
| COLLATERAL_VAULT | `0x9C948B4dA40F017102dAAe78afd956829E32d05e` |
| LOAN_BOOK | `0x42215B392c3C22Af3fbBE45d370114C43F536031` |
| ADMIN (EOA) | `0x6358c6B980fad929247b932207893b4dB2F7cd82` |
| KEEPER (EOA) | `0xb7783C2b65DA5Fed091fb9AB7996AA662Ae0a4Fd` |
| VAULT_OPERATOR (EOA) | `0x363Ef1CABcE629FF862d3f62cA15E4bd89599992` |

The chunk verifier (`DepthPoCDArrayVerifier`) is live at
`0x71548d2B3CEE856E17315e2E286491233E571E75` — 17,892 deployed bytes, verified via
`cast code` (not part of the deployments JSON; `MONIAOracle` reaches it through the
`PoCDVerifierAdapter`).

## Makefile targets

Verified target list (Makefile:2-46):

| Target | What it does |
|---|---|
| `make help` | prints the summary below |
| `make circuits` | `circuits/build_pocd_gate.sh` + `circuits/build_solvency.sh` (single-sum PoCD + CollateralSolvency: compile → setup → verifier.sol → prove → verify) |
| `make circuits-array` | `node packages/eerc-node/src/gen_pocd_array_input.mjs` then `circuits/build_pocd_array.sh` — the **chunked** array PoCD (N=10 ticks/chunk, K=4); **requires** `circuits/build/powersOfTau28_hez_final_20.ptau` (2^20) to be downloaded first (build_pocd_array.sh:10-12) |
| `make build` | `cd contracts && forge build` |
| `make test` | `test-contracts` + `test-dash` |
| `make test-contracts` | `cd contracts && forge test` |
| `make test-dash` | `cd dashboard && npm run test --silent \|\| true` (vitest; failures don't fail make) |
| `make anvil` | `anvil --silent &` — a vanilla Anvil is now sufficient for **real-verifier** deploys too (chunked verifier fits EIP-170) |
| `make deploy-local` | `bash scripts/deploy_local.sh` **then** `node packages/eerc-node/src/register_all.mjs` |
| `make demo` | `bash demo/run_demo.sh` |
| `make clean` | `forge clean` + remove circuit build intermediates (`*_js`, `*.wtns`, `*.zkey`) |

## PROFILE plumbing end-to-end

`PROFILE` is a *labeling* profile; the actual on-chain numbers travel as
`EPOCH_LEN`/`TENOR_BLOCKS`:

1. **Root `.env` / demo scripts** set `PROFILE` (root `.env` has `PROFILE=DEMO`;
   `run_demo.sh:11` and `run_autonomous.sh:10` export it plus `EPOCH_LEN`/`TENOR_BLOCKS`).
2. **Deploy**: `DeployAll.s.sol` reads `EPOCH_LEN` (default 60) and `TENOR_BLOCKS`
   (default 150) via `vm.envOr` and passes them to the `AuctionHouse` and `LoanBook`
   constructors (DeployAll.s.sol:41-42, 73, 89). PROD intent: 3600s epoch / 10800 tenor
   blocks (`.env.example` comments).
3. **Services** honor the chain, not the env: keeper/scenario read
   `auction.epochLength()` and `book.tenorBlocks()` back from the contracts
   (scenario.mjs:43, services/keeper/index.mjs:18).
4. **Indexer** echoes the profile to clients: `GET /epoch/clock` returns
   `{ …, profile: process.env.PROFILE || "DEMO", tenorMs, now }`
   (services/indexer/index.mjs:173-178).
5. **Dashboard**: `register_all.mjs` writes `VITE_PROFILE=DEMO` into `dashboard/.env`
   (register_all.mjs:53); `dashboard/src/config.ts` maps it through
   `TIME_PROFILES = { DEMO: {epochLenMs: 60_000, tenorMs: 300_000}, PROD: {epochLenMs: 3_600_000, tenorMs: 21_600_000} }`
   (config.ts:20-23) plus `MIN_BID_MICRO` (DEMO 1 USDC / PROD 10 USDC, config.ts:40-43).

## Environment variable reference

### Root `.env.example` (template) and root `.env` (gitignored, real values)

From `.env.example` (all names verified) plus the **Fuji additions** now set in the
real root `.env`. Since the Fuji deployment, root `.env` is a **Fuji-first config**:
the vars marked ✦ are set, and notably `RPC_LOCAL` now points at the **Fuji RPC** (it
is the var services read — chain.mjs:14) with `CHAIN_ID=43113`, `EPOCH_LEN=120`,
`TENOR_BLOCKS=60`, `KEEPER_STALL_S=300`. The local demo scripts are unaffected: they
export their own values explicitly (run_demo.sh/run_autonomous.sh override, and
`deploy_local.sh` never sources `.env`).

| Var | Meaning | Notes |
|---|---|---|
| `PROFILE` ✦ | `DEMO` (seconds) \| `PROD` (hours) | echoed by indexer `/epoch/clock` |
| `EPOCH_LEN` ✦ | AuctionHouse epoch window, seconds | DeployAll default 60; **root `.env` = 120 (Fuji)**; demo scripts 60/10 |
| `TENOR_BLOCKS` ✦ | loan tenor in blocks | DeployAll default 150; **root `.env` = 60 (Fuji, ~2s blocks)**; demo 10 (scripted) / 5 (autonomous) |
| `CONTROL_PORT` | Control API port | code default 8899 (services/control/index.mjs:15) |
| `INDEXER_PORT` | indexer port | code default 8787 (services/indexer/index.mjs:9) |
| `RPC_LOCAL` ✦ | the RPC **services actually read** (chain.mjs:14) | code default `http://127.0.0.1:8545`; **root `.env` now sets it to the Fuji RPC** |
| `RPC_FUJI` ✦ | `https://api.avax-test.network/ext/bc/C/rpc` | consumed by `fund_fuji.mjs`, `deploy_fuji.sh`, `run_fuji.sh` |
| `CHAIN_ID` ✦ | chain id services use to pick `deployments/<id>.json` | code default 31337 (chain.mjs:15); **root `.env` = 43113** |
| `CHAIN_ID_FUJI` ✦ | `43113` | legacy/informational; scripts export `CHAIN_ID` directly |
| `SNOWTRACE_API_KEY` | optional, contract verification | deploy scripts pass `dummy` |
| `LENDER1_PK` `LENDER2_PK` `BORROWER_PK` ✦ | member EOAs (secret — names only) | Fuji throwaways in root `.env`; demo scripts override with Anvil defaults #3/#4/#5 |
| `AGENT4_PK` `AGENT5_PK` ✦ | extra simulated-agent EOAs (secret) | **generated for Fuji**; Anvil #6/#7 in demos (actors.mjs) |
| `ADMIN_PK` ✦ | admin EOA = eERC owner + auditor (secret) | Anvil #0 in demos |
| `KEEPER_PK` ✦ | keeper EOA (secret) | Anvil #1 in demos |
| `VAULT_OPERATOR_PK` ✦ | registered eERC EOA custodying collateral (secret) | Anvil #2 in demos |
| `WALLET_PRIVATE_KEY` ✦ | **Fuji faucet funding source** (secret) | used ONLY by `scripts/fund_fuji.mjs` to gas-fund the 8 actors |
| `KEEPER_STALL_S` ✦ | keeper stall-guard, seconds | code default 120; **root `.env` = 300 (Fuji)** |
| `AUDITOR_BJJ_PRIV` ✦ | auditor BabyJubJub scalar (secret) | demo scripts use the fixed demo scalar |
| `AUDITOR_BJJ_PUB_X` / `AUDITOR_BJJ_PUB_Y` ✦ | auditor pubkey = S·G | passed to `MONIAOracle` constructor as `AUDITOR_PUB_X/Y` (deploy_local.sh:23, deploy_fuji.sh:32, DeployAll.s.sol:40-41) |
| `TESTUSDC_ADDR` … `LOAN_BOOK_ADDR` (commented) | deployed addresses | authoritative source is `contracts/deployments/<chainid>.json`, not env |

Service-tuning vars not in `.env.example` but read by code:
`KEEPER_POLL_MS`, `ADMIN_POLL_MS`, `AGENTS_POLL_MS`, `OPERATOR_POLL_MS`, `BLOCK_SEC`
(indexer display estimate, indexer/index.mjs:17).

### Dashboard `VITE_*` vars

Auto-written to `dashboard/.env` by `register_all.mjs:50-74` after every deploy:
`VITE_ADAPTER=live`, `VITE_PROFILE=DEMO`, `VITE_CHAIN_ID`, `VITE_RPC_LOCAL`,
**`VITE_RPC_FUJI` (only when `CHAIN_ID === 43113` — the dashboard live path reads it
for that chain id, register_all.mjs:56-57)**, `VITE_INDEXER_URL`, `VITE_CONTROL_URL`,
`VITE_TESTUSDC_ADDR`, `VITE_EERC_ADDR`, `VITE_REGISTRAR_ADDR`,
`VITE_MEMBER_REGISTRY_ADDR`, `VITE_AUCTION_HOUSE_ADDR`, `VITE_MONIA_ORACLE_ADDR`,
`VITE_COLLATERAL_VAULT_ADDR`, `VITE_LOAN_BOOK_ADDR`, `VITE_ADMIN_ADDR`,
`VITE_KEEPER_ADDR`.

`dashboard/.env.example` additionally documents `VITE_RPC_FUJI` and
`VITE_SNOWTRACE_URL`; defaults for everything live in `dashboard/src/config.ts:49-72`.
`VITE_ADAPTER=mock` (the default in config.ts:9) runs the zero-backend in-browser
simulation — see `05-dashboard.md`.

## How to run everything

```bash
# scripted local demo (fresh anvil -> deploy -> register -> indexer+control -> scenario)
make demo                          # == bash demo/run_demo.sh

# autonomous demo (all six services, no script; loans cycle unattended)
bash demo/run_autonomous.sh

# backend assertion harness / member smoke (against an already-deployed stack,
# i.e. after steps 1-4 of run_demo.sh or after run_autonomous's deploy — with the
# same env exported; REPAY_ONLY=1 for the short version)
node demo/verify_backend.mjs
node demo/smoke_member.mjs

# tests
make test                          # forge test + dashboard vitest
cd contracts && forge test         # contracts only

# circuits (one-time; array build needs the 2^20 ptau downloaded to
# circuits/build/powersOfTau28_hez_final_20.ptau first)
make circuits
make circuits-array

# deploy to a running anvil (a VANILLA anvil is fine — the chunked verifier fits EIP-170)
make deploy-local                  # deploy_local.sh + register_all.mjs

# Fuji (LIVE) — one-time prereqs in this order, then run the service stack:
cd services && node ../scripts/fund_fuji.mjs && cd ..   # gas-fund the 8 actors from WALLET_PRIVATE_KEY
bash scripts/deploy_fuji.sh                             # deploy; writes deployments/43113.json
CHAIN_ID=43113 node packages/eerc-node/src/register_all.mjs
bash demo/run_fuji.sh                                   # all six services against Fuji; logs /tmp/window_fuji_*.log

# dashboard
cd dashboard && npm install && npm run dev    # http://localhost:5173
# mock mode by default; live mode after a deploy (register_all writes dashboard/.env)
```
