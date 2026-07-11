# 04 — Off-chain Services (`services/`)

The Node service stack that keeps the market alive off-chain: a read-only **indexer**, a
single write API (**control**), and four autonomous daemons (**keeper**, **agents**,
**admin**, **operator**). All of them are thin loops over a shared library
(`services/lib/`) that in turn reuses the proven crypto flows from
`packages/eerc-node/src/eerc.mjs` (see `03-circuits-and-proving.md`). Contracts and
addresses are described in `02-contracts.md`; how the stack is launched end-to-end is in
`06-demo-and-ops.md`.

## Contents

- [Shared library `services/lib/`](#shared-library-serviceslib)
  - [chain.mjs](#chainmjs)
  - [actors.mjs](#actorsmjs)
  - [roles.mjs](#rolesmjs)
  - [memberops.mjs](#memberopsmjs)
  - [adminops.mjs — the only plaintext surface](#adminopsmjs--the-only-plaintext-surface)
- [The six runnable services](#the-six-runnable-services)
  - [indexer (:8787)](#indexer-8787)
  - [control (:8899)](#control-8899)
  - [keeper](#keeper)
  - [agents](#agents)
  - [admin](#admin)
  - [operator](#operator)
- [package.json, deps, and how services start](#packagejson-deps-and-how-services-start)
- [Security / trust model](#security--trust-model)

---

## Shared library `services/lib/`

### chain.mjs

`services/lib/chain.mjs` — provider, wallets, and contract handles.

- `RPC = process.env.RPC_LOCAL || "http://127.0.0.1:8545"`, `CHAIN_ID = process.env.CHAIN_ID || 31337` (chain.mjs:14-15).
- `provider` — a single shared `ethers.JsonRpcProvider(RPC)` (chain.mjs:16).
- ABIs come from the Foundry build output: `abi(name, sol)` reads
  `contracts/out/<sol>.sol/<name>.json` (chain.mjs:22-24). Addresses come from
  `deployments()` which reads `contracts/deployments/<CHAIN_ID>.json` (chain.mjs:18-20).
- `wallet(pk)` wraps the wallet in an `ethers.NonceManager` (chain.mjs:26-28).
- **`handles(signerPk)`** (chain.mjs:39-59) is the key primitive: it returns a **cached
  bundle of all 8 contract handles** — `usdc` (SimpleERC20 at `TESTUSDC_ADDR`), `eerc`
  (EncryptedERC), `registrar` (Registrar), `registry` (MemberRegistry), `auction`
  (AuctionHouse), `oracle` (MONIAOracle), `vault` (CollateralVault), `book` (LoanBook) —
  plus `d` (the deployments object). All contracts for a given key share **one
  NonceManager**, and repeated `handles(pk)` calls return the **same cached bundle**
  (`_handleCache` keyed by pk, `"__read__"` for the read-only/provider case), so nonces
  stay in sync across every contract and call site for that EOA. This is what lets six
  concurrent services fire txs from the same actors without nonce collisions per-process.

### actors.mjs

`services/lib/actors.mjs` — the actor registry for the whole demo stack.

- Eight actors with **Anvil default keys #0–#7**: `admin`, `keeper`, `operator`,
  `lender1`, `lender2`, `borrower`, `agent4`, `agent5` (actors.mjs:7-16). Each is
  **env-overridable** via `ADMIN_PK`, `KEEPER_PK`, `VAULT_OPERATOR_PK`, `LENDER1_PK`,
  `LENDER2_PK`, `BORROWER_PK`, `AGENT4_PK`, `AGENT5_PK` (actors.mjs:18-22, applied at 30-39).
- Each actor gets a **deterministic BabyJubJub raw scalar**
  `bjjRaw = keccak256("the-window:bjj:" + name)` (actors.mjs:25-27) so eERC balances can
  always be re-decrypted without storing key material.
- `ACTORS` (name → `{name, pk, address, bjjRaw, role}`), `BY_ADDRESS`, and
  `actorByAddress(addr)` for reverse lookup (actors.mjs:29-46).
- **`AGENTS`** — the scripted bid book, five entries (actors.mjs:49-55):
  `lender1` ask tick 6 size 400, `lender2` ask tick 8 size 500, `borrower` bid tick 30
  size 350 ("desperate borrower"), `agent4` bid tick 12 size 300, `agent5` bid tick 16
  size 120 ("noise trader"). `side: 0` = ask/lend, `side: 1` = bid/borrow.
- `MEMBER_NAMES` — the five on-chain members (everyone but admin/keeper/operator)
  (actors.mjs:58).
- **`AUDITOR`** — the auction auditor BabyJubJub keypair: `priv` from
  `AUDITOR_BJJ_PRIV` and `pub` `[x, y]` from `AUDITOR_BJJ_PUB_X/Y`, with hard-coded demo
  defaults (actors.mjs:60-66). Every encrypted bid is encrypted to this key.

### roles.mjs

`services/lib/roles.mjs` — three re-exports of privileged keys from `ACTORS`:
`ADMIN_PK`, `KEEPER_PK`, `OPERATOR_PK` (roles.mjs:4-6). Nothing else.

### memberops.mjs

`services/lib/memberops.mjs` — reusable **member** operations, performed server-side with
the proven `packages/eerc-node` flows for the disclosed simulated members. Used by the
Control API and by the autonomous admin.

| Function | What it does |
|---|---|
| `registerMember(actorName)` | Idempotent; if not registered, builds the BJJ user from `bjjRaw`, generates a real registration proof (`genRegistrationProof`), calls `registrar.register` (memberops.mjs:37-45). |
| `faucet(actorName, amount)` | Public `usdc.mint` to the actor (memberops.mjs:21-26). |
| `wrap(actorName, amount)` | Mint TestUSDC + approve eERC + `eerc.deposit(amount, TESTUSDC_ADDR, pct[7])` with a Poseidon-encrypted amount PCT (memberops.mjs:48-59). |
| `unwrap(actorName, amount)` | Reads own encrypted balance, decrypts it with the member's own `bjjRaw` (`decryptEGCT`, BSGS bound `1<<20`), generates a real withdraw proof (`genWithdrawProof`) against the eERC auditor (= **admin's registered key**, memberops.mjs:70), calls `eerc.withdraw` (memberops.mjs:63-74). |
| `submitBid(actorName, side, tick, size)` | Encrypts `size` to `AUDITOR.pub` (`encryptMessage` → EGCT), then `auction.submitAsk(tick, egct, "0x")` if `side === 0`, else `auction.submitBid(tick, egct)` (memberops.mjs:77-85). |
| `lockCollateral(actorName, loanId, coll=6000, loan=5000)` | Real ZK solvency proof (`genSolvencyProof`, coll ≥ 1.2×loan) from `circuits/build`, then `vault.lockCollateral(loanId, cColl, cLoan, ownerPub, a, b, c)` (memberops.mjs:88-94). |
| `lockByLoan(loanId, coll, loan)` | Resolves the loan's borrower via `book.loans(loanId)` → known actor, delegates to `lockCollateral` (memberops.mjs:29-35). |
| `balanceOf(actorName)` | Returns `{usdc, registered, eercClear, eercEncrypted}` — decrypts the member's **own** eERC balance with the member's `bjjRaw` (memberops.mjs:97-113). |

Note the decryption asymmetry: `memberops` only ever decrypts a member's **own** balance
with that member's key. Decrypting *other people's* ciphertexts (the per-tick bid
aggregates) happens only in `adminops`.

### adminops.mjs — the ONLY plaintext surface

`services/lib/adminops.mjs` — admin (auditor-key) operations, used by both the autonomous
admin loop and the Control API. Header comment (adminops.mjs:1-2): *"The ONLY plaintext
surface. HARD RULE: never log plaintext sizes."* This is the **only place in the entire
codebase where `AUDITOR.priv` decrypts market ciphertexts** (`decryptEGCTDirect(AUDITOR.priv, …)`,
adminops.mjs:38-39). Neither the browser, nor the indexer, nor any member flow ever sees
plaintext bid sizes.

| Function | What it does |
|---|---|
| `decryptDepth(H, epoch)` | For all 37 ticks, reads `auction.getAggregate(epoch, ASK/BID, t)` and decrypts each aggregate EGCT under the auditor key (BSGS bound `1<<20`). Returns `{askAgg, bidAgg, askSum, bidSum}` (adminops.mjs:30-42). |
| `computeClearing(askSum, bidSum)` | **JS mirror of `MONIAOracle._computeClearing`** — must agree with the on-chain algorithm or `postPrint` reverts (adminops.mjs:16-27). Walks ticks low→high accumulating supply against remaining demand; returns `{crossing, matched, trade}` with `NO_TRADE = 65535` (adminops.mjs:11). |
| `printEpoch(adminPk, epoch)` | Full print: require epoch `Closed` (status 2) → `decryptDepth` → `computeClearing` → real **chunked** PoCD (`genDepthArrayProof` under the auditor key returns `{proofs: [{a,b,c,publicSignals} × 4]}`, ~30s) → `oracle.postPrint(epoch, rStar, depth, proofs.map(p => ({a, b, c})))` — the new `Groth16Proof[4]` signature (adminops.mjs:52-58). The HTTP surface (`POST /admin/print/:epoch`) and return shape `{epoch, rStarTick, rStarBps (= 100 + 25*crossing), matched, trade}` are **unchanged** (adminops.mjs:45-60). |
| `matchEpoch(adminPk, epoch)` | Reads `oracle.rateAt(epoch)`; if a trade exists, collects lenders from `AskSubmitted` events with `tick <= r*` and borrowers from `BidSubmitted` with `tick >= r*`, pairs them index-wise, posts `book.postMatches(epoch, ms)` with a zero cSize placeholder, returns the created loan ids (`nextLoanId` before + n) (adminops.mjs:63-83). |
| `confirmFunding(adminPk, loanId)` / `repay(adminPk, loanId)` | Auditor-attested `book.confirmFunding` / `book.repay` with a 32-byte zero attestation blob (`LoanBook` is `onlyAdmin` for these) (adminops.mjs:86-93). |

---

## The six runnable services

| Service | Entry file | HTTP | Role |
|---|---|---|---|
| indexer | `services/indexer/index.mjs` | `:8787` (`INDEXER_PORT`) | Read-only REST API; rebuilds all state from chain events |
| control | `services/control/index.mjs` | `:8899` (`CONTROL_PORT`) | The single write API (member/admin/keeper ops) |
| keeper | `services/keeper/index.mjs` | — | Cron: open/close epochs, seize defaulted loans, stall-guard |
| agents | `services/agents/index.mjs` | — | Scripted simulated members: encrypted bids each Open epoch |
| admin | `services/admin/index.mjs` | — | Autonomous auditor + loan-lifecycle orchestrator |
| operator | `services/operator/index.mjs` | — | Vault-operator custody: confirms requested collateral locks |

### indexer (:8787)

`services/indexer/index.mjs` — read-only. **Rebuilds ALL state from chain events every
3 s** (`setInterval(rebuild, 3000)`, indexer:230) and is crash-safe by design: *"no
persistence, re-derives everything from chain on boot + poll"* (indexer:1-3). Port:
`INDEXER_PORT` default **8787** (indexer:9). Responses are shaped to the dashboard's
frozen adapter types (`dashboard/src/lib/adapter/types.ts`); see `05-dashboard.md`.

`rebuild()` (indexer:32-166) re-derives: epoch clock (`currentEpoch`, `epochStatus`,
`epochStart`, `epochLength`), prints (decoding the `postPrint` **calldata** of each
`RatePrinted` tx to recover the proven depth curve, indexer:60-88, plus `NoTrade` epochs
as stale prints, indexer:90-96), all loans from `book.loans(id)` (indexer:99-115), a
~200-event firehose from LoanBook/Vault events (indexer:117-133), per-member bids from
`AskSubmitted`/`BidSubmitted` events — **who + tick only; size stays the LOCKED
ciphertext placeholder** (indexer:136-148) — and members from `MemberAdded` events
(indexer:151-163). `deadlineAt` is estimated with `BLOCK_SEC` (env, default 2)
(indexer:17, 112). Rate ticks map to bps as `100 + 25*tick` (indexer:11).

Route table (all GET):

| Route | Response |
|---|---|
| `/health` | `{ok: true, lastBlock}` (indexer:171) |
| `/epoch/clock` | Current epoch clock `{epoch, status, openedAt, closesAt, epochLenMs}` **plus `profile: process.env.PROFILE \|\| "DEMO"`, `tenorMs` (tenorBlocks × BLOCK_SEC × 1000), and chain `now` in ms** (indexer:173-178) |
| `/events?since=<block>` | Firehose entries `{type, block, …}` with `block >= since`; types: `RatePrinted` (carries `print`), `NoTrade`, `LoanCreated`, `Funded`, `Repaid`, `Seized`, `CollateralLocked/Released/Seized` (indexer:180-183) |
| `/bids?address=<addr>` | That address's bids: `{id, epoch, side: 'ask'\|'bid', tick, bps, size: LOCKED, status: 'submitted'}[]` (indexer:185-188) |
| `/monia/latest` | Most recent `MoniaPrint` `{epoch, rStarBps\|null, aggVolume, depth[{tick,bps,supply,demand}], pocd:{verified,txHash}, printedAt, stale}` or `null` (indexer:191-194) |
| `/monia/history?limit=<n>` | Last `limit` (default 40) prints ascending by epoch (indexer:196-200) |
| `/depth?epoch=<e>` | The depth array of that print (default: latest printed epoch), `[]` if none (indexer:202-208) |
| `/loans` | All loans `{id, epoch, lender, borrower, rateBps, size(ciphertext), deadlineBlock, deadlineAt, status: None/Pending/Active/Repaid/Defaulted}` (indexer:210, 30) |
| `/members` | `{address, simulated: true, active, joinedEpoch, roles: ['public']}[]` (indexer:211) |
| `/aggregates/:epoch` | Raw per-side/tick aggregate ciphertexts for the explorer split-screen — **no plaintext**: 74 rows `{side, tick, agg: {c1:[x,y], c2:[x,y]}}` (indexer:214-226) |

### control (:8899)

`services/control/index.mjs` — **the single backend the dashboard triggers for writes**
(control:1-4). Member and admin proving run here, server-side; the auditor key never
leaves. Port: `CONTROL_PORT` default **8899** (control:14). Bodies may identify the actor
by name (`actor`) or address (`address`) — `resolveActor` maps either to an actor name
(control:20-24). All responses are `{ok: true, …}` or HTTP 400 `{ok: false, error}`.
Proof-bearing routes include `proofMs` (wall time of the whole op).

| Route | Body | Lib handler |
|---|---|---|
| `GET /health` | — | — (control:30) |
| `GET /actors` | — | Lists `{name, address, role}` for all 8 actors (control:31) |
| `POST /member/register` | `{actor\|address}` | `memberops.registerMember` (control:34) |
| `POST /member/faucet` | `{actor\|address, amount}` | `memberops.faucet` (control:35) |
| `POST /member/wrap` | `{actor\|address, amount}` | `memberops.wrap` (control:36) |
| `POST /member/unwrap` | `{actor\|address, amount}` | `memberops.unwrap` (control:37) |
| `POST /member/bid` | `{actor\|address, side, tick, size}` | `memberops.submitBid` (control:38) |
| `POST /member/lock` | `{loanId, coll?, loan?}` | `memberops.lockByLoan` (control:39) |
| `GET /member/balance/:addr` | — | `memberops.balanceOf` (unknown addr → `{usdc:"0", registered:false, eercClear:null}`) (control:40) |
| `POST /member/fund` | `{loanId}` | `adminops.confirmFunding(ADMIN_PK, …)` — auditor-attested, not really a "member" op (control:42) |
| `POST /member/repay` | `{loanId}` | `adminops.repay(ADMIN_PK, …)` (control:43) |
| `POST /admin/print/:epoch` | `{}` | `adminops.printEpoch(ADMIN_PK, epoch)` (control:46) |
| `POST /admin/matches/:epoch` | `{}` | `adminops.matchEpoch(ADMIN_PK, epoch)` → `{loans: [ids]}` (control:47) |
| `GET /admin/decrypt/:epoch` | — | `adminops.decryptDepth` → `{depth: [{tick, bps, supply, demand}]}` **plaintext, admin only** (control:48) |
| `GET /admin/clearing/:epoch` | — | `decryptDepth` + `computeClearing` → `{rStarBps\|null, matched}` (control:49) |
| `POST /keeper/open` | — | `auction.openEpoch()` as keeper (control:52) |
| `POST /keeper/close` | — | `auction.closeEpoch()` as keeper (control:53) |
| `POST /keeper/seize` | `{loanId}` | `book.seize(loanId)` as keeper (control:54) |

Note the comment at control:41: fund/repay are auditor-attested (`LoanBook` `onlyAdmin`);
the operator service confirms the vault lock first.

### keeper

`services/keeper/index.mjs` — stateless cron, no HTTP. **Requires `KEEPER_PK`** (throws
without it, keeper:7-8). Polls every `KEEPER_POLL_MS` (default 3000, keeper:9). Each tick
(keeper:16-63):

1. **Open**: if no epoch yet or the current one is not Open — open a new epoch when the
   previous is Printed, **or when the stall-guard fires**: if an epoch stays `Closed`
   without a print for `KEEPER_STALL_S` seconds (default 120; e.g. admin down or print
   reverted), it opens anyway so the loop never wedges (keeper:25-37, `closedAt` map at 14).
2. **Close**: if the current epoch is Open and `now >= epochStart + epochLength`, call
   `closeEpoch()` (keeper:38-48).
3. **Seize**: for every loan with `state == Active` and `blockNumber > deadlineBlock`,
   call `book.seize(id)` (keeper:51-62).

Idempotency comes from contract reverts — double-fires are swallowed (keeper:1-3, catch blocks).

### agents

`services/agents/index.mjs` — scripted **simulated** members (disclosed as such,
agents:1-2). Polls every `AGENTS_POLL_MS` (default 3000). When the current epoch is Open
and it hasn't bid in it yet (`lastBidEpoch` guard, agents:9,16), each of the five
`AGENTS` entries encrypts its scripted size to `AUDITOR.pub` and submits
`submitAsk(tick, egct, "0x")` (side 0) or `submitBid(tick, egct)` (side 1)
(agents:18-28). Failures (already bid / not a member) are skipped silently.

### admin

`services/admin/index.mjs` — the **autonomous auditor + loan-lifecycle orchestrator**;
"the ONLY plaintext surface … Never logs plaintext" (admin:1-5). Polls every
`ADMIN_POLL_MS` (default 4000). For each epoch seen in status `Closed` and not yet
handled (a `handled` set, retried on error, admin:44-58), `processEpoch` (admin:17-42):

1. `printEpoch` — decrypt, clear, real chunked PoCD (4 × 10-tick proofs), `postPrint`.
2. If a trade: `matchEpoch` — post matches, get loan ids.
3. Per loan: `lockCollateral(borrower, id)` (real solvency proof, via memberops) →
   `op.vault.confirmLock(id, ethers.id("ref"+id))` **as the operator directly**
   (admin:33) → `confirmFunding(ADMIN_PK, id)` (loan becomes Active) → **repay every
   loan except the last** (`repay-most`), leaving the final one to default so the keeper
   seizes it past deadline (admin:35-40).

So the autonomous stack cycles complete loan lifecycles unattended, including a default →
seize each matched epoch.

### operator

`services/operator/index.mjs` — the registered vault-operator custody role. Polls every
`OPERATOR_POLL_MS` (default 3000). For each loan id `< book.nextLoanId()`, reads
`vault.locks(id)` and when **`lock.state === 1` (Requested)** — i.e. a member locked
collateral with a valid solvency proof — calls
`vault.confirmLock(id, ethers.id("op-ref-"+id))` (operator:14-27). This is the
**dashboard-driven path**; per the header comment (operator:3-4) *and verified in
`services/admin/index.mjs:33`*, the autonomous admin orchestrator also confirms locks
directly with `OPERATOR_PK`, so the operator service is only load-bearing when a human
drives the lock from the dashboard.

---

## package.json, deps, and how services start

`services/package.json`: ESM (`"type": "module"`), deps `cors ^2.8.5`, `dotenv ^16.4.5`,
`ethers ^6.13.0`, `express ^4.19.2` (package.json:13-18). Scripts (package.json:7-12):

```json
"indexer": "node indexer/index.mjs",
"keeper":  "node keeper/index.mjs",
"admin":   "node admin/index.mjs",
"agents":  "node agents/index.mjs"
```

**Note:** there are *no* npm scripts for `control` or `operator` — run them with
`node control/index.mjs` / `node operator/index.mjs`, which is exactly what
`demo/run_autonomous.sh` does. That script (see `06-demo-and-ops.md`) starts a fresh
anvil (`--block-time 1` so time advances for the keeper), deploys, runs
`packages/eerc-node/src/register_all.mjs`, then backgrounds **all six** services with
logs in `/tmp/window_*.log` (run_autonomous.sh:35-43), after exporting the whole env:
`RPC_LOCAL, CHAIN_ID=31337, EPOCH_LEN=10, TENOR_BLOCKS=5, INDEXER_PORT=8787,
CONTROL_PORT=8899, PROFILE=DEMO, KEEPER_STALL_S=45, ADMIN_POLL_MS=3000,
KEEPER_POLL_MS=2000, AGENTS_POLL_MS=2000, OPERATOR_POLL_MS=2000`, all eight actor PKs
(anvil defaults, explicitly set so a root `.env` with Fuji keys can't override), and the
auditor BJJ keypair (run_autonomous.sh:10-23).

Env var summary (all read in the files cited above):

| Var | Used by | Default |
|---|---|---|
| `RPC_LOCAL`, `CHAIN_ID` | chain.mjs | `http://127.0.0.1:8545`, `31337` |
| `INDEXER_PORT`, `BLOCK_SEC`, `PROFILE` | indexer | `8787`, `2`, `DEMO` |
| `CONTROL_PORT` | control | `8899` |
| `KEEPER_PK` (required), `KEEPER_POLL_MS`, `KEEPER_STALL_S` | keeper | —, `3000`, `120` |
| `AGENTS_POLL_MS` | agents | `3000` |
| `ADMIN_POLL_MS` | admin | `4000` |
| `OPERATOR_POLL_MS` | operator | `3000` |
| `ADMIN_PK`, `VAULT_OPERATOR_PK`, `LENDER1_PK`, `LENDER2_PK`, `BORROWER_PK`, `AGENT4_PK`, `AGENT5_PK` | actors.mjs | Anvil #0–#7 |
| `AUDITOR_BJJ_PRIV`, `AUDITOR_BJJ_PUB_X`, `AUDITOR_BJJ_PUB_Y` | actors.mjs | demo constants |

---

## Security / trust model

The browser holds **no keys and no circuits** (see `05-dashboard.md`): every write it
makes is an HTTP call to the Control API, which signs with server-side actor keys and
generates proofs with the server-side `eerc-node` flows. Private keys travel only in env
vars: `ADMIN_PK` (auditor/admin EOA — printing, matching, attested fund/repay),
`KEEPER_PK` (epoch open/close + seize), `VAULT_OPERATOR_PK` (lock confirmation), and the
five member keys (`LENDER1_PK`, `LENDER2_PK`, `BORROWER_PK`, `AGENT4_PK`, `AGENT5_PK`)
for the disclosed simulated members. The **auditor BabyJubJub private key**
(`AUDITOR_BJJ_PRIV`) exists only in the `admin` and `control` service processes via
`services/lib/actors.mjs` → `services/lib/adminops.mjs`; it is the only key that can turn
per-tick bid aggregates into plaintext, and `adminops.mjs` is the only module that does
so. The indexer serves only what the chain already reveals (ticks, addresses, lifecycle
events, ciphertexts, and PoCD-proven aggregate depth from `postPrint` calldata); member
balance decryption uses each member's own deterministic `bjjRaw`, never the auditor key.
This is a demo posture — Anvil default keys are public test keys with no real funds
(actors.mjs:1-3) — but the *shape* (plaintext confined to one auditable module,
browser fully key-free) is the production design. See `07-decisions-and-gotchas.md`.
