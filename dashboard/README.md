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
  **genuine ElGamal over BabyJubJub** (a browser port of `packages/eerc-node/elgamal.mjs`), so the
  Explorer shows real `c1/c2` on-chain-style data. Everything is a pure function of `(seed, scenario)`
  → deterministic replay, safe for a live pitch.
- **`LiveAdapter`** (`src/lib/adapter/live/`) — the same interface against Avalanche Fuji. Wired today:
  public TestUSDC balance + registration status (viem reads), and M-ONIA/depth/loans via the indexer
  REST client. **Pending** (marked `EercNotReady`): the 5 money-market contract reads (add ABIs to
  `contracts.ts` once deployed) and eERC proof-bearing writes / encrypted-balance decryption (attach
  the bridge — see `hooks/useEercBridge.ts`). Nothing is fabricated.

Switch with `VITE_ADAPTER=mock|live` (see `.env.example`).

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
