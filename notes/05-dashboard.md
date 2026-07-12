# 05 — Dashboard (`dashboard/`)

React 18 + Vite + TypeScript SPA: wagmi/viem for wallet, zustand for state,
@tanstack/react-query available, recharts for charts, tailwind for styling
(`dashboard/package.json`). It is a **view + control surface** over the off-chain
services (`04-services.md`): in live mode all reads come from the indexer (:8787) and
all writes go through the Control API (:8899) — the browser holds **no private keys and
no circuit artifacts**.

## Contents

- [Adapter pattern](#adapter-pattern)
- [LiveAdapter — method → HTTP route map](#liveadapter--method--http-route-map)
- [MockAdapter — deterministic zero-backend demo](#mockadapter--deterministic-zero-backend-demo)
- [Config (`src/config.ts`)](#config-srcconfigts)
- [Routes and pages](#routes-and-pages)
- [Hooks](#hooks)
- [Zustand stores](#zustand-stores)
- [Env: auto-written `.env`](#env-auto-written-env)
- [Stale README warning](#stale-readme-warning)

---

## Adapter pattern

Every page talks to one frozen interface and never knows which implementation is behind it.

- `src/lib/adapter/WindowAdapter.ts` — the interface: clock/profile, public reads
  (`getLatestMonia`, `getMoniaHistory`, `getDepthCurve`, `getMembers`, `getLoanBook`,
  `getRawCiphertexts`), session reads (`getSession`, `getBalances`,
  `decryptOwnBalance`, `getMyBids`, `getMyLoans`), member writes (`register`, `faucet`,
  `wrap`, `unwrap`, `submitAsk`, `submitBid`, `lockCollateral`, `fund`, `repay`), keeper
  (`closeEpoch`, `seize`), admin (`adminDecryptAggregates`, `adminComputeClearing`,
  `adminPostPrint`, `adminPostMatches`), and a `subscribe` firehose + `recentEvents()`
  snapshot (WindowAdapter.ts:27-77). A separate `DemoControls` interface
  (play/pause/setSpeed/seek/reseed/loadScenario/stepEpoch) is exposed only by the mock;
  `hasDemoControls()` type-guards it (WindowAdapter.ts:80-92).
- `src/lib/adapter/types.ts` — the shared DTO types (Address, Ciphertext, MoniaPrint,
  DepthPoint, Loan, MyBid, EpochClock, WindowEvent, …). The indexer explicitly shapes its
  responses to these types (services/indexer/index.mjs:1-2).
- `src/lib/adapter/index.ts` — the single entry point. `getAdapter()` lazy-imports the
  adapter selected by `ADAPTER_MODE` (from `VITE_ADAPTER`, `mock` | `live`, default
  `mock`) and **memoizes it behind a promise guard** so concurrent `init()` calls never
  double-construct or double-load WASM (index.ts:4-35). `__resetAdapter()` is test-only.

## LiveAdapter — method → HTTP route map

`src/lib/adapter/live/LiveAdapter.ts`. Reads go through **IndexerAPI**
(`src/services/indexer.ts`): a REST client with `fetchWithRetry` (2 retries, 8 s
timeout, backoff on 429; indexer.ts:15-35) and a **4-second TTL cache** capped at 200
entries (indexer.ts:11-13, 37-50) against `INDEXER_URL` (:8787 in local live mode).
Cache is bypassed for `/epoch/clock`, `/events`, `/bids`, `/health` (indexer.ts:59-63).
Every write is a `fetch` to the Control API at `CONTROL_URL` (:8899) via the `ctrl()`
helper, which throws unless the response has `ok: true` (LiveAdapter.ts:16-25). The
header comment states the posture: writes are performed server-side with real proofs,
"so the browser holds no keys and needs no eERC SDK / circuit artifacts"
(LiveAdapter.ts:10-13).

Verified method → route map:

| Adapter method | HTTP call | Source line |
|---|---|---|
| `getEpochClock` / `subscribeClock` (1 s poll) | `GET {INDEXER}/epoch/clock` | 77-89 |
| `getLatestMonia` | `GET {INDEXER}/monia/latest` | 91 |
| `getMoniaHistory(limit=40)` | `GET {INDEXER}/monia/history?limit=` | 92-94 |
| `getDepthCurve(epoch?)` | `GET {INDEXER}/depth?epoch=` | 95 |
| `getMembers` | `GET {INDEXER}/members` | 96 |
| `getLoanBook(filter?)` | `GET {INDEXER}/loans` (+ client-side status filter) | 97-101 |
| `getRawCiphertexts(epoch)` | `GET {INDEXER}/aggregates/:epoch` | 103-106 |
| `getSession` / `getBalances` / `decryptOwnBalance` | `GET {CONTROL}/member/balance/:addr` | 108-125 |
| `getMyBids(a)` | `GET {INDEXER}/bids?address=` | 126 |
| `getMyLoans(a)` | derived from `getLoanBook()` (lender/borrower match) | 127-130 |
| `register(a)` | `POST {CONTROL}/member/register` `{address}` | 145 |
| `faucet(a, amt)` | `POST {CONTROL}/member/faucet` `{address, amount}` | 146 |
| `wrap(a, amt)` | `POST {CONTROL}/member/wrap` `{address, amount}` | 147 |
| `unwrap(a, amt)` | `POST {CONTROL}/member/unwrap` `{address, amount}` | 148 |
| `submitAsk(a, tick, size)` | `POST {CONTROL}/member/bid` `{address, side: 0, tick, size}` | 149 |
| `submitBid(a, tick, size)` | `POST {CONTROL}/member/bid` `{address, side: 1, tick, size}` | 150 |
| `lockCollateral(id, _amt)` | `POST {CONTROL}/member/lock` `{loanId}` (amount ignored — server uses demo coll/loan defaults) | 151 |
| `fund(id)` | `POST {CONTROL}/member/fund` `{loanId}` | 152 |
| `repay(id)` | `POST {CONTROL}/member/repay` `{loanId}` | 153 |
| `closeEpoch(_e)` | `POST {CONTROL}/keeper/close` `{}` | 156 |
| `seize(id)` | `POST {CONTROL}/keeper/seize` `{loanId}` | 157 |
| `adminDecryptAggregates(e)` | `GET {CONTROL}/admin/decrypt/:epoch` | 160 |
| `adminComputeClearing(e)` | `GET {CONTROL}/admin/clearing/:epoch` (+ depth via `adminDecryptAggregates`) | 161-164 |
| `adminPostPrint(e)` | `POST {CONTROL}/admin/print/:epoch`, then `GET {CONTROL}/admin/decrypt/:epoch` and **synthesizes the `MoniaPrint` locally** — deliberately does NOT re-read `/monia/latest` (avoids racing the indexer's 3 s rebuild) | 165-182 |
| `adminPostMatches(e)` | `POST {CONTROL}/admin/matches/:epoch` then re-reads `/loans` | 183-186 |
| `subscribe(cb)` | polls `GET {INDEXER}/events?since=` every 2 s; `mapEvent` maps `BidSubmitted`, `EpochOpened`, `EpochClosed`, `RatePrinted`, `LoanCreated`→`MatchesPosted` (real `epoch`, joined by the indexer from the loan record), `Funded`, `Repaid`, `Seized`/`CollateralSeized`→`LoanSeized` | 189-221 |

Other notes: `setActor(a)` is called by `useEercBridge` to reflect the connected
wallet/persona (LiveAdapter.ts:71); all reads degrade gracefully (empty/null) when
services are down; the private `tx()` helper surfaces `{phase: 'proving', label:
'proving (server-side)…'}` through `onProof` and returns `proofMs` + `gasUsed` (the
Control API returns the receipt's gas stringified; `tx()` coerces it to number)
(LiveAdapter.ts:133-144). `/keeper/open` exists on the Control API but no LiveAdapter
method calls it (the keeper daemon opens epochs). LiveAdapter also implements
`auditorKey()` (async — fetches the PUBLIC auditor key from control `GET /auditor`) so
the Diagnostics card renders in live mode; MockAdapter's remains synchronous and
`Diagnostics.tsx` handles both via `Promise.resolve(...)`. (The dead pre-Control-API
leftover `src/lib/adapter/live/contracts.ts` was deleted in the submission-hardening
pass.)

## MockAdapter — deterministic zero-backend demo

`src/lib/adapter/mock/` — the default (`VITE_ADAPTER` unset ⇒ mock). A fully client-side,
deterministic simulation:

- **`MockAdapter.ts`** — implements `WindowAdapter` + `DemoControls`. Drives a
  `DemoEngine` on a 120 ms real-time tick (MockAdapter.ts:60-69) and simulates honest
  proof latency phases ("building witness… → generating proof… → verifying…") via
  `simulateProof` (MockAdapter.ts:29-47).
- **`engine.ts`** — `DemoEngine`, "the deterministic heart of the simulation": a seeded,
  virtual-clock event timeline (agents bid → close → M-ONIA print with PoCD → matches →
  loans borrow→repay→release, occasional default→seize). Everything is a pure function of
  `(seed, scenario)` — no `Date.now`/`Math.random` in domain logic — so scrub/replay is
  byte-identical (engine.ts:1-7). Note its **sim timings differ from config**: DEMO
  epochs are 22 s with a 30 s tenor for watchability (engine.ts:45-48).
- **`elgamal.browser.ts`** — **real ElGamal over BabyJubJub in the browser** (circomlibjs
  port of `packages/eerc-node/src/elgamal.mjs`): keypair, encrypt, homomorphic
  `addCipher`, `decryptToPoint`, and BSGS discrete-log recovery — so the Explorer shows
  genuine `c1/c2` ciphertexts and genuinely aggregated sums with no backend
  (elgamal.browser.ts:1-19).
- **`scenarios.ts`** — four seeded presets for the demo control bar: `happy-path`,
  `default-and-seize`, `no-trade`, `rate-spike` (scenarios.ts:11-36).
- **`strategies.ts`** — the README §12 agent archetypes as pure seeded functions
  (yield-lender, opportunistic-lender, desperate-borrower, opportunistic-borrower,
  noise), tuned so supply/demand realistically cross (strategies.ts:19-60).
- **`members.ts`** — fixed roster of five SIMULATED members with deterministic fake
  addresses (`fakeAddress(label)`) + simulated admin/keeper personas (members.ts:29-49).
- **`rng.ts`** — mulberry32 PRNG (`Rng`) + `epochSeed(base, epoch)`; also emits
  deterministic bigint scalars for ElGamal randomness (rng.ts:4-40).

## Config (`src/config.ts`)

- `ADAPTER_MODE` from `VITE_ADAPTER` (default `mock`); `PROFILE` from `VITE_PROFILE`
  (default `DEMO`) (config.ts:9-10).
- **`TIME_PROFILES`** (config.ts:20-23): DEMO `epochLenMs: 60_000` / `tenorMs: 300_000`
  (labels "60s" / "5m"); PROD `3_600_000` / `21_600_000` ("1h" / "6h"). All durations must
  read from a profile — "never hardcode durations elsewhere" (config.ts:2).
- Fixed protocol params (config.ts:29-37): `USDC_DECIMALS = 6`,
  **`HAIRCUT_BPS = 12_000` (120% collateral)**, rate band 1.00%–10.00% annualized →
  `RATE_MIN_BPS = 100`, `RATE_MAX_BPS = 1000`, `TICK_BPS = 25`, **`TICK_COUNT = 37`**.
- Min bid (micro-USDC): DEMO 1 USDC, PROD 10 USDC (config.ts:40-43).
- Chain wiring (config.ts:49-56): `CHAIN_ID` (default 43113 Fuji), `RPC_FUJI`,
  `RPC_LOCAL`, **`INDEXER_URL`** (default `/api`), **`CONTROL_URL`** (default
  `http://127.0.0.1:8899`), `SNOWTRACE_URL` (default `https://testnet.snowtrace.io`). In the
  hosted build `INDEXER_URL`/`CONTROL_URL` point at the Render services (see [08](08-hosting-and-deployment.md)).
- `SNOWTRACE_URL` + the link builders `EXPLORER_TX(hash, base)` / `EXPLORER_ADDR(addr, base)`
  (`src/constants/ui.ts`) — **previously defined but unused; now wired** into the tx feed +
  toasts (`76a52d5`, see "On-chain tx surfacing" below).
- `ADDRESSES` — the 8 deployed contract addresses from `VITE_*_ADDR` (config.ts:59-68).
- **`ADMIN_ADDR` / `KEEPER_ADDR`** (config.ts:71-72) — persona gating: in
  `useSessionStore.personaFor(addr)`, a connected address equal to `ADMIN_ADDR` gets
  persona `['admin']`, `KEEPER_ADDR` gets `['keeper']`, everyone else
  `['lender','borrower']` (useSessionStore.ts:6-11).
- `TAGLINE = 'The rate is public. The borrowing never was.'` (config.ts:75).

## Routes and pages

Routes from `src/App.tsx:87-101`, all under a shared `Layout`, lazy-loaded, wrapped in
an ErrorBoundary + ToastProvider. `RoleGate` (`src/components/RoleGate.tsx`) guards by
`need: 'connected' | 'member' | 'admin' | 'keeper'` against the session store's persona.

| Path | Page | Gate | What it does |
|---|---|---|---|
| `/` | `MarketHome` | public | Hero market view: M-ONIA ticker, depth chart, epoch countdown, stat tiles (members, loans), PoCD badge, tagline. |
| `/explorer` | `Explorer` | public | "What the chain sees" split view: live event feed (bids show tick but LOCKED ciphertext sizes), raw `c1/c2` aggregate ciphertexts. |
| `/methodology` | `Methodology` | public | Static explainer: what's hidden vs. visible, time profiles, haircut, rate band, admin framing (honest-claims copy). |
| `/diagnostics` | `Diagnostics` | public | Adapter mode/profile/chain/address config dump + gas/constraint gate numbers (≈13k gas accumulate, ≈266k PoCD verify, ≈12k constraints). |
| `/app` | `Console` | member | Member landing: balances (encrypted + reveal), quick links to wallet/auction/positions. |
| `/app/wallet` | `WalletPage` | connected | Faucet, register (proof), wrap/unwrap (proof) — `adapter.faucet/register/wrap/unwrap` via `useTx`. |
| `/app/auction` | `AuctionPage` | member | Rate-tick picker + size → `adapter.submitAsk` / `submitBid` (encrypted bid), depth chart, countdown, own-bid list. |
| `/app/positions` | `PositionsPage` | member | Loan cards (live/settled). `LoanCard` calls `adapter.lockCollateral(id, requiredCollateral(size, HAIRCUT_BPS))`, `adapter.fund(id)`, `adapter.repay(id)` (LoanCard.tsx:26-28). |
| `/ops/admin` | `AdminConsole` | admin | The auditor console: `adapter.adminDecryptAggregates(e)` (AdminConsole.tsx:33), `adminComputeClearing(e)` (:39), `adminPostPrint(e, onP)` (:44), `adminPostMatches(e)` (:52). |
| `/ops/keeper` | `KeeperConsole` | keeper | `adapter.closeEpoch(clock.epoch)` (KeeperConsole.tsx:24) and per-loan `adapter.seize(id)` (:29, enabled past deadline). |
| `*` | `NotFound` | public | 404. |

## Hooks

All in `src/hooks/`, one-liners verified against source headers:

- **`useClock`** — subscribes to the adapter's virtual clock; all countdowns derive from `clock.now`, never `Date.now()`, so DEMO scrubbing and PROD block-time both work.
- **`useMarketData`** — wires the adapter into `useMarketStore`: clock ticks + refresh on market events (`RatePrinted`, `EpochClosed`, `MatchesPosted`, `LoanFunded`, `LoanRepaid`, `LoanSeized`) and a poll.
- **`useMyData`** — hydrates the connected address's balances/bids/loans into `usePositionsStore`, refreshing on clock ticks and a poll.
- **`useEercBridge`** — live-mode only: reflects the connected wagmi wallet / selected persona into `LiveAdapter.setActor` (the browser needs no eERC SDK; writes are server-side).
- **`useTx`** — wraps any proof-bearing adapter write, threading `onProof` into a phase state machine with honest copy ("building witness… → generating proof… → verified ✓").
- **`useEventFeed`** — scrub-safe feed that resyncs from `adapter.recentEvents()` each tick (reflects backward scrubbing in mock mode).
- **`useGlobalEvents`** — global toast notifications for key events, mounted once in Layout; deduped by epoch/loan id and throttled.
- **`useWalletSync`** — syncs the wagmi connection into `useSessionStore` (`source='wallet'`), coexisting with mock PersonaSwitcher selections (`source='persona'`).
- (Also present, not adapter-related: `useAnimatedNumber`, `useCopyToClipboard`, `useKeyboardShortcuts`.)

## On-chain tx surfacing + live tx feed (`76a52d5`)

Real Fuji transactions are now shown throughout the UI with clickable Snowtrace links:

- **`components/ui/TxLink.tsx`** — a compact `↗ tx` link (`EXPLORER_TX(hash, SNOWTRACE_URL)`);
  renders nothing when there's no hash (mock events / missing tx).
- **`components/ui/LiveTxFeed.tsx`** — a prominent "Live on-chain activity" card mounted on
  `MarketHome` (home page). Reuses `useEventFeed()`, filters to events that carry a `txHash`,
  shows a one-line label per event + a `TxLink`. This is the main "liveliness" surface.
- **`WindowEvent` (`lib/adapter/types.ts`)** — the on-chain variants now intersect a
  `TxMeta { txHash?: Hex; block?: number }`, and a new **`EpochOpened`** variant was added.
  `Loan` gained `createdTx?: Hex | null`.
- **`LiveAdapter.mapEvent`** threads `e.txHash`/`e.block` through and now maps `BidSubmitted`,
  `EpochOpened`, `EpochClosed` (previously dropped). `getLoanBook` spreads `createdTx` straight
  from the indexer.
- **`Explorer.tsx`** rows each render a per-event `TxLink`.
- **`contexts/ToastContext.tsx`** — `success(message, txHash?)` / `showToast(message, type, txHash?)`
  gained an optional `txHash`; when present the toast shows a "View tx …" Snowtrace link. All
  `useTx` callers pass `res.txHash`: `WalletPage` (register/faucet/wrap/unwrap), `AuctionPage`
  (bid), `AdminConsole` (print), `KeeperConsole` (close/seize), `LoanCard` (lock/fund/repay).
  This works because the Control API now returns `txHash` (see [04](04-services.md)).

## Zustand stores

All in `src/stores/`:

- **`useAdapterStore`** — holds the memoized `WindowAdapter` instance + `init()`; every hook goes through it.
- **`useMarketStore`** — public market state: clock, latest M-ONIA, history, depth, members, loan book.
- **`usePositionsStore`** — session positions: balances, `revealed` (self-decrypted eERC balance), my bids, my loans.
- **`useSessionStore`** — connected address, source (wallet/persona), persona array (admin/keeper gating via `ADMIN_ADDR`/`KEEPER_ADDR`), registered flag.
- **`useDemoStore`** — mock-only demo controls (play/pause/speed/seek/reseed/scenario/stepEpoch), proxied through `hasDemoControls`.
- **`useUiStore`** — DEMO/PROD profile toggle backing the ProfileSwitch.

## Env: auto-written `.env`

`dashboard/.env` is **auto-written by `packages/eerc-node/src/register_all.mjs`**
(register_all.mjs:50-71), which runs during deploy (`demo/run_autonomous.sh:33`; see
`06-demo-and-ops.md`). It writes:

```
VITE_ADAPTER=live
VITE_PROFILE=DEMO
VITE_CHAIN_ID=<chainId>            # 31337 locally
VITE_RPC_LOCAL=<rpc>
VITE_INDEXER_URL=http://127.0.0.1:<INDEXER_PORT|8787>
VITE_CONTROL_URL=http://127.0.0.1:<CONTROL_PORT|8899>
VITE_TESTUSDC_ADDR / VITE_EERC_ADDR / VITE_REGISTRAR_ADDR / VITE_MEMBER_REGISTRY_ADDR
VITE_AUCTION_HOUSE_ADDR / VITE_MONIA_ORACLE_ADDR / VITE_COLLATERAL_VAULT_ADDR / VITE_LOAN_BOOK_ADDR
VITE_ADMIN_ADDR / VITE_KEEPER_ADDR
```

So after a fresh local deploy the dashboard boots straight into live mode with correct
addresses and persona gating — don't hand-edit `.env`, it gets overwritten.

**`dashboard/.env.production`** (gitignored, hand-maintained) is the **Vercel build** env —
Vite loads it in `build` mode. Same `VITE_*` keys, but `VITE_INDEXER_URL`/`VITE_CONTROL_URL`
point at the **Render** services instead of localhost. See [08](08-hosting-and-deployment.md).

## Stale README warning

`dashboard/README.md` is **partially stale**: it still describes the LiveAdapter's
money-market reads and eERC writes as "**Pending** (marked `EercNotReady`)"
(README.md:39-44). That was superseded by commit `15b508e` ("LiveAdapter -> Control API
(all writes wired)"): every write now goes through the Control API as tabled above, and
reads come from the indexer. Trust this note set and the source, not that README section.
