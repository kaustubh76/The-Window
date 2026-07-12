# 08 — Hosting & Cloud Deployment (Vercel + Render + Docker)

How THE WINDOW is served **publicly on the internet** (added after commit `76a52d5`). This is
separate from the *on-chain* Fuji deployment in [06-demo-and-ops](06-demo-and-ops.md) → "Fuji
deployment" (that already put the contracts on-chain); this doc is about hosting the **off-chain**
frontend + read/write APIs so anyone can use the dashboard from a browser.

> The `the_window_architecture.excalidraw` diagram is intentionally **not** changed by this work —
> hosting is an ops overlay, and the tx-surfacing feature only added fields/UI, not new on-chain or
> service *flows*. The diagram still reflects the true architecture.

## Live URLs (current)

| Piece | URL | Notes |
|---|---|---|
| Frontend | **https://the-window-five.vercel.app** | Vercel, project `the-window`, account `kaustubh76` |
| Indexer (read API) | **https://window-indexer.onrender.com** | Render web service `srv-d99i04m7r5hc73b9kl90` |
| Control (write API) | **https://window-control.onrender.com** | Render web service `srv-d99i05faqgkc7388064g` |
| Backend image | `docker.io/kaushtubh02/thewindow-backend:latest` | public Docker Hub repo |
| Render owner id | `tea-d5pi8nogjchc73dv1ikg` | needed for API service creation |

## Topology

```
 browser ──HTTPS──► Vercel (static dist, VITE_ADAPTER=live)
   │                    │  fetches
   │                    ├──► https://window-indexer.onrender.com   (reads: /events /loans /monia/* …)
   │                    └──► https://window-control.onrender.com   (writes: /member/* /admin/* /keeper/*)
   └──HTTPS──► Fuji C-Chain RPC (viem/wagmi, direct, no backend)

 Render window-indexer / window-control  ──► Fuji RPC (read chain / send txs)
 Local Mac: keeper + agents + operator + admin  (demo/run_fuji.sh)  ──► Fuji RPC  (drive the auction)
```

Only `indexer` and `control` are hosted (the two HTTP services the frontend talks to). The four
autonomous **drivers run on the local Mac** — see "Free-tier reality" below. Everyone reads the same
Fuji state, so it doesn't matter where the drivers run.

CORS: both services already `app.use(cors())` (wildcard) — no change was needed for cross-origin
fetches from the Vercel origin.

## The backend Docker image (`Dockerfile` + `.dockerignore`, repo root)

Render can't build the backend from a fresh git clone, because the files the services read at
runtime are **gitignored** (see [07](07-decisions-and-gotchas.md)): `contracts/out/**` ABIs,
`contracts/deployments/43113.json`, and the `circuits/build/*` PoCD+solvency zkeys/wasm. So we build
a Docker image locally (where those files exist on disk) and push it to Docker Hub; Render pulls it.

`Dockerfile` (selective COPY — ships ~110 MB of artifacts, not the 1.5 GB `circuits/build`):
- base `node:20-bookworm-slim`; `apt-get install build-essential python3` (native deps for
  `packages/eerc-node`: ffjavascript / circomlibjs / maci-crypto).
- `npm ci --omit=dev` in **both** `services/` and `packages/eerc-node/` (relative cross-package
  imports + separate `node_modules`; the whole tree is needed, not just `services/`).
- `COPY` `services/` + `packages/eerc-node/src` + `contracts/out` + `contracts/deployments/43113.json`
  + the 4 runtime circuit artifacts (`circuits/build/depth_array_final.zkey`,
  `depth_pocd_array_js/depth_pocd_array.wasm`, `solvency_final.zkey`,
  `collateral_solvency_js/collateral_solvency.wasm`) + EERC submodule circom
  `registration/withdraw/transfer`.
- default `CMD` = indexer; Render overrides per service.

`.dockerignore` only strips `**/node_modules` (+ `.git`); everything else is selected explicitly by
the Dockerfile's `COPY` lines.

**Build + push (must be amd64 — Mac is arm64, Render is amd64):**
```
docker buildx build --platform linux/amd64 -t kaushtubh02/thewindow-backend:latest --push .
```
Resulting image is ~352 MB. See [07](07-decisions-and-gotchas.md) for the arm64/amd64 gotcha.

## Render services (free tier)

Two **free web services**, both from the one image, differing only in start command + env:

| Service | id | dockerCommand | port env |
|---|---|---|---|
| `window-indexer` | `srv-d99i04m7r5hc73b9kl90` | `node services/indexer/index.mjs` | `INDEXER_PORT=10000` |
| `window-control` | `srv-d99i05faqgkc7388064g` | `node services/control/index.mjs` | `CONTROL_PORT=10000` |

- `dockerCommand` is a **plain exec** string — NOT `sh -c '…'` (Render tokenizes naively → exit 127;
  see [07](07-decisions-and-gotchas.md)). Since we can't expand `$PORT` in the command, we set the
  port env vars to `10000` (Render's default `$PORT`) statically instead.
- Env vars (set from the root `.env`): all actor PKs (`ADMIN_PK`, `KEEPER_PK`, `VAULT_OPERATOR_PK`,
  `LENDER1_PK`, `LENDER2_PK`, `BORROWER_PK`, `AGENT4_PK`, `AGENT5_PK`), auditor
  `AUDITOR_BJJ_PRIV`/`PUB_X`/`PUB_Y`, `RPC_LOCAL=https://api.avax-test.network/ext/bc/C/rpc` (chain.mjs
  reads `RPC_LOCAL` only — there is no `RPC_FUJI` fallback), `CHAIN_ID=43113`, `PROFILE=DEMO`,
  `EPOCH_LEN`, `TENOR_BLOCKS`, `START_BLOCK`. Indexer doesn't use the keys/zkeys; control does.
- `RENDER_API_KEY` lives in the root `.env`. Manage services via the REST API, e.g. create:
  ```
  POST https://api.render.com/v1/services      (Bearer $RENDER_API_KEY)
  { "type":"web_service", "name":"window-indexer", "ownerId":"tea-d5pi8nogjchc73dv1ikg",
    "image": { "ownerId":"tea-d5pi8nogjchc73dv1ikg", "imagePath":"docker.io/kaushtubh02/thewindow-backend:latest" },
    "serviceDetails": { "runtime":"image", "plan":"free", "region":"oregon",
                        "healthCheckPath":"/health",
                        "envSpecificDetails": { "dockerCommand":"node services/indexer/index.mjs" } },
    "envVars": [ {"key":"RPC_LOCAL","value":"…"}, … ] }
  ```
  Single env var upsert: `PUT /v1/services/{id}/env-vars/{KEY}  {"value":"…"}` (note: **PUT**, POST 405s).
  Trigger a redeploy: `POST /v1/services/{id}/deploys  {"imageUrlOverride":"docker.io/kaushtubh02/thewindow-backend:latest"}`.

## Vercel frontend (prebuilt static)

The dashboard is deployed as a **prebuilt static `dist`**, not a Vercel source-build — this keeps the
baked backend URLs deterministic (see [07](07-decisions-and-gotchas.md)).

- Build env: `dashboard/.env.production` (gitignored; Vite loads it in `build` mode) — `VITE_ADAPTER=live`,
  `VITE_CHAIN_ID=43113`, `VITE_RPC_FUJI=<public Fuji RPC>`, `VITE_INDEXER_URL=https://window-indexer.onrender.com`,
  `VITE_CONTROL_URL=https://window-control.onrender.com`, and all `VITE_*_ADDR` from `dashboard/.env`.
- `cd dashboard && npm run build` → copy `dist/*` into `dashboard/.vercel_static/` (gitignored) + a
  `vercel.json` SPA rewrite: `{ "rewrites": [{ "source": "/((?!assets/|window.svg).*)", "destination": "/index.html" }] }`
  (excludes real static assets from the catch-all).
- Deploy: `cd dashboard/.vercel_static && npx vercel deploy --prod --yes --name the-window` (Vercel CLI
  auth is stored in `~/Library/Application Support/com.vercel.cli`).

## Redeploy runbook (after code changes)

1. **Backend** (any `services/` or `packages/eerc-node` change):
   ```
   docker buildx build --platform linux/amd64 -t kaushtubh02/thewindow-backend:latest --push .
   # then POST /v1/services/{id}/deploys for BOTH srv- ids (imageUrlOverride = the image)
   ```
2. **Frontend** (any `dashboard/` change):
   ```
   cd dashboard && npm run build
   rm -rf .vercel_static && mkdir .vercel_static && cp -R dist/* .vercel_static/ && <write vercel.json>
   cd .vercel_static && npx vercel deploy --prod --yes --name the-window
   ```
3. **Drivers** (any `services/{keeper,agents,operator,admin}` or `services/lib` change): restart
   `bash demo/run_fuji.sh` on the Mac so the new code loads.

## Free-tier reality (important)

- Render free tier has **no always-on background workers** — that's why the 4 drivers run on the Mac.
  The hosted **site is always up** (serves whatever Fuji state exists to any visitor), but the auction
  only **advances** while `demo/run_fuji.sh` is running locally. Fully hands-off 24/7 needs a paid
  Render worker.
- Free web services **cold-start** (~30–60 s) after ~15 min idle and share a 750 instance-hours/month
  cap. First hit after idle shows a brief loading state.
- `control` is open-CORS + unauthenticated by design and holds throwaway Fuji actor keys as Render env
  secrets — acceptable for a testnet demo, **never** for real value.

## Prerequisites (one-time, before hosting)

The on-chain prereqs live in [06](06-demo-and-ops.md): `scripts/fund_fuji.mjs` (gas-fund actors),
`scripts/deploy_fuji.sh` (deploy contracts → `contracts/deployments/43113.json`),
`CHAIN_ID=43113 RPC_LOCAL=$RPC_FUJI node packages/eerc-node/src/register_all.mjs` (register members +
auditor). Those must have run before the hosted services do anything useful.
