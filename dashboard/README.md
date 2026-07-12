# THE WINDOW — Dashboard

The web app for **THE WINDOW**, a private machine money market on Avalanche (eERC).
_The rate is public. The borrowing never was._

One unified React app with three zones:

- **Public** — the M-ONIA ticker, aggregate depth curve, the Explorer split-screen (the demo closer), Methodology, and Diagnostics.
- **Member console** — connect (wallet or a simulated persona), register your encryption key, wrap TestUSDC, submit encrypted bids/asks, manage loans.
- **Ops** — the Administrator console (decrypt → compute r\* → generate PoCD → print M-ONIA → post matches) and the Keeper console (close epochs, seize).

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

The app boots in **mock mode** — a deterministic, in-browser simulation (the `DemoEngine`)
that drives a full scripted market with **zero backend**. It's fully demoable out of the box.

```bash
npm run build        # tsc + vite build
npm run test         # vitest (27 tests: money/rate math, eERC crypto, engine determinism, honest-claims lint)
npm run typecheck
```

## Data architecture — one interface, two adapters

Every page talks to a single typed interface, `WindowAdapter` (`src/lib/adapter/WindowAdapter.ts`).
Pages never know which adapter is behind it.

- **`MockAdapter`** (`src/lib/adapter/mock/`) — the default. A seeded virtual-clock event timeline
  runs a full epoch loop: agents bid → epoch closes → M-ONIA prints with a PoCD → matches →
  loans cycle borrow → repay → release, with occasional defaults → seize. Ciphertexts are
  **genuine ElGamal over BabyJubJub** (a circomlibjs browser port of the ElGamal flows in
  `packages/eerc-node/src/eerc.mjs`), so the
  Explorer shows real `c1/c2` on-chain-style data. Everything is a pure function of `(seed, scenario)`
  → deterministic replay, safe for a live pitch.
- **`LiveAdapter`** (`src/lib/adapter/live/`) — the same interface against the REAL deployed stack
  (Avalanche Fuji). **Fully wired, reads AND writes**: reads come from the indexer REST API
  (`VITE_INDEXER_URL`) and **every write goes through the Control API** (`VITE_CONTROL_URL`,
  `services/control` :8899), where the server generates the real Groth16 proofs and signs with
  server-side keys — the browser holds no keys and no circuit artifacts. Every write returns the
  real Fuji `txHash` (surfaced as Snowtrace links) + receipt `gasUsed`. Nothing is fabricated, and
  there is **no silent fallback to mock**: if the services are down, live mode shows a
  "Connecting to services…" banner and empty state — never simulated data.

Switch with `VITE_ADAPTER=mock|live` (see `.env.example`). The hosted app
(https://the-window-five.vercel.app) is a prebuilt static bundle with `live` baked in,
pointed at the Render-hosted indexer/control services.

## The demo

A fixed **DemoControlBar** (bottom, mock only) gives play/pause, speed (0.5–4×), a deterministic
timeline scrubber, a seed field, and scenario presets:

| Scenario | What it shows |
|---|---|
| `happy-path` | Agents bid, M-ONIA prints, loans borrow → repay → release |
| `default-and-seize` | A borrower misses the deadline; the keeper seizes collateral |
| `no-trade` | Curves don't cross; M-ONIA carries the last print, flagged stale |
| `rate-spike` | Desperate borrowing pushes the clearing rate higher |

The **two-screen moment** is `/explorer`: encrypted ciphertext streaming on the left, the public
M-ONIA rate + depth curve on the right, with the tagline in the seam.

## Honest-claims guardrail

The Benchmark Administrator holds the auditor key and **can** decrypt individual amounts — the
documented, SOFR-style trust model. The UI states this proudly and **never** claims "trustless",
"undecryptable", or "nobody can see the bids". This is enforced in CI by
`src/lib/honestClaims.test.ts`, which greps every source file for forbidden phrases and asserts each
M-ONIA print renders a PoCD badge.

## Stack

React 18 · Vite 5 · TypeScript 5 · Tailwind 3 (Benchmark-Terminal theme: gold = public rate,
cyan = encrypted) · Zustand · wagmi + viem · Recharts · circomlibjs. `vite-plugin-node-polyfills`
provides the `Buffer`/`process` globals circomlibjs needs in the browser.
