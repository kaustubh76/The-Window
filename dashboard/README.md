# THE WINDOW — Dashboard

The web app for **THE WINDOW**, a private machine money market on Avalanche (eERC).
_The rate is public. The borrowing never was._

One unified React app with three zones:

- **Public** — the M-ONIA ticker, aggregate depth curve, the Explorer split-screen (the demo closer), Methodology, and Diagnostics.
- **Member console** — join as a real on-chain member (or step into a demo actor), register your encryption key, wrap TestUSDC, submit encrypted bids/asks, manage loans.
- **Ops** — the Administrator console (decrypt → compute r\* → generate PoCD → print M-ONIA → post matches) and the Keeper console (close epochs, seize).

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

The app is **live-only**: every number on screen is read from the deployed chain via the
indexer, and every write is a real transaction. `dashboard/.env` points at the hosted
Render services by default, so `npm run dev` shows the real Fuji market with zero local
backend. To run against local services instead, start them (`demo/run_fuji.sh`) and point
`VITE_INDEXER_URL`/`VITE_CONTROL_URL` at :8787/:8899.

```bash
npm run build        # tsc + vite build
npm run test         # vitest (money/rate math, unit-boundary locks, honest-claims lint)
npm run typecheck
```

## Data architecture — one interface, one live path

Every page talks to a single typed interface, `WindowAdapter` (`src/lib/adapter/WindowAdapter.ts`),
implemented by exactly one adapter:

- **`LiveAdapter`** (`src/lib/adapter/live/`) — the interface against the REAL deployed stack
  (Avalanche Fuji). **Fully wired, reads AND writes**: reads come from the indexer REST API
  (`VITE_INDEXER_URL`) and **every write goes through the Control API** (`VITE_CONTROL_URL`,
  `services/control` :8899), where the server generates the real Groth16 proofs and signs with
  server-side keys — the browser holds no keys and no circuit artifacts. Every write returns the
  real Fuji `txHash` (surfaced as Snowtrace links) + receipt `gasUsed`. Nothing is fabricated,
  and there is **no fallback to simulated data**: if the services are down, the app shows a
  "Connecting to services…" banner and empty state — never fake numbers.

The former in-browser mock adapter was removed (`feat/live-only-no-mock`); a CI guard in
`src/lib/honestClaims.test.ts` fails the build if any mock reference returns to `src/`.
The hosted app (https://the-window-five.vercel.app) is a prebuilt static bundle pointed at
the Render-hosted indexer/control services.

## The demo

The market runs itself: four autonomous drivers (keeper, agents, operator, admin) on
GitHub Actions open epochs, submit encrypted bids, print M-ONIA with an on-chain PoCD,
and cycle loans 24/7 — every event in the feed links to Snowtrace. The
**two-screen moment** is `/explorer`: encrypted ciphertext streaming on the left, the public
M-ONIA rate + depth curve on the right, with the tagline in the seam.

Scripted agents are disclosed with a `sim` badge; members onboarded through
**Join The Window** are real on-chain participants (minted, funded, and registered
server-side) and carry no badge.

## Honest-claims guardrail

The Benchmark Administrator holds the auditor key and **can** decrypt individual amounts — the
documented, SOFR-style trust model. The UI states this proudly and **never** claims "trustless",
"undecryptable", or "nobody can see the bids". This is enforced in CI (the
`dashboard-ci` workflow runs `tsc` + `vitest` on every change) by
`src/lib/honestClaims.test.ts`, which greps every source file for forbidden phrases, asserts each
M-ONIA print renders a PoCD badge, requires the live feed to keep its Snowtrace verifiability
claim, and forbids any mock-adapter reference from returning to `src/`.

## Stack

React 18 · Vite 5 · TypeScript 5 · Tailwind 3 (Benchmark-Terminal theme: gold = public rate,
cyan = encrypted) · Zustand · wagmi + viem · Recharts · circomlibjs. `vite-plugin-node-polyfills`
provides the `Buffer`/`process` globals circomlibjs needs in the browser.
