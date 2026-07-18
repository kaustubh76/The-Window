# 08 — Hosting & Cloud Deployment (Vercel + Render + Docker)

How THE WINDOW is served **publicly on the internet** (added after commit `76a52d5`). This is
separate from the *on-chain* Fuji deployment in [06-demo-and-ops](06-demo-and-ops.md) → "Fuji
deployment" (that already put the contracts on-chain); this doc is about hosting the **off-chain**
frontend + read/write APIs so anyone can use the dashboard from a browser.

> The `the_window_architecture.excalidraw` diagram **does** depict this hosting layer: it is
> script-generated (`scripts/regen_architecture_diagram.py` reads the hand-authored
> `the_window_architecture.base.excalidraw` and writes the canonical file) and includes a
> **HOSTING & AUTOMATION** band (Vercel · Render indexer/control · Docker Hub · GitHub Actions
> drivers · Fuji) plus a "why this wins a speedrun" callout. Regen + validate:
> `python3 scripts/regen_architecture_diagram.py && python3 scripts/check_diagram_overlaps.py`.

## Live URLs (current)

| Piece | URL | Notes |
|---|---|---|
| Frontend | **https://the-window-five.vercel.app** | Vercel, project `the-window`, account `kaustubh76` |
| Indexer (read API) | **https://window-indexer-w3pv.onrender.com** | Render web service `srv-d9dgsof7f7vs738k1bk0` |
| Control (write API) | **https://window-control-opuo.onrender.com** | Render web service `srv-d9dgsvrbc2fs73e09tc0` |
| Backend image | `docker.io/kaushtubh02/thewindow-backend:latest` | public Docker Hub repo |
| Render owner id | `tea-d9dgp6n41pts73d3ueu0` | current (2nd) Render account; needed for API service creation |

> **Render account migration (2026-07-18):** the ORIGINAL Render account hit the free-tier
> **750 instance-hours/month** cap and Render **`billing`-suspended all its services** — and
> billing-suspended services **cannot be resumed via the API** (only user-suspended ones can),
> so the backend was **redeployed to a fresh Render account** (the URLs/IDs above). The old,
> suspended services (`window-indexer.onrender.com` `srv-d99i04m7r5hc73b9kl90`,
> `window-control.onrender.com` `srv-d99i05faqgkc7388064g`) are dead — kept here only so old
> links/logs are traceable.

## Topology

```
 browser ──HTTPS──► Vercel (static dist, VITE_ADAPTER=live)
   │                    │  fetches
   │                    ├──► https://window-indexer-w3pv.onrender.com   (reads: /events /loans /monia/* …)
   │                    └──► https://window-control-opuo.onrender.com   (writes: /member/* /admin/* /keeper/*)
   └──HTTPS──► Fuji C-Chain RPC (viem/wagmi, direct, no backend)

 Render window-indexer / window-control  ──► Fuji RPC (read chain / send txs)
 GitHub Actions (fuji-drivers workflow): keeper + agents + operator + admin ──► Fuji RPC (drive the auction)
```

Only `indexer` and `control` are hosted on Render (the two HTTP services the frontend talks to).
The four autonomous **drivers run in the cloud on GitHub Actions** — see "Drivers in the cloud"
below. Everyone reads the same Fuji state, so it doesn't matter where the drivers run;
`demo/run_fuji.sh` remains the local-dev way to drive the market (disable the workflow first —
two drivers sharing keys race nonces).

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

| Service | id | dockerCommand | port |
|---|---|---|---|
| `window-indexer` | `srv-d9dgsof7f7vs738k1bk0` | `node services/indexer/index.mjs` | reads `$PORT` |
| `window-control` | `srv-d9dgsvrbc2fs73e09tc0` | `node services/control/index.mjs` | reads `$PORT` |

- `dockerCommand` is a **plain exec** string — NOT `sh -c '…'` (Render tokenizes naively → exit 127;
  see [07](07-decisions-and-gotchas.md)). Rather than expand `$PORT` in the command, the services
  **read `process.env.PORT` directly** (PR #15): `const PORT = Number(process.env.INDEXER_PORT ||
  process.env.PORT || 8787)` (control: `CONTROL_PORT || PORT || 8899`). Render injects `$PORT` and
  routes to it, so the plain command Just Works — no static port env var needed. (`control` also
  needs `INDEXER_URL` = the indexer's public URL, since it calls the indexer for some reads.)
- Env vars (set from the root `.env`): all actor PKs (`ADMIN_PK`, `KEEPER_PK`, `VAULT_OPERATOR_PK`,
  `LENDER1_PK`, `LENDER2_PK`, `BORROWER_PK`, `AGENT4_PK`, `AGENT5_PK`), auditor
  `AUDITOR_BJJ_PRIV`/`PUB_X`/`PUB_Y`, `RPC_LOCAL=https://api.avax-test.network/ext/bc/C/rpc` (chain.mjs
  reads `RPC_LOCAL` only — there is no `RPC_FUJI` fallback), `CHAIN_ID=43113`, `PROFILE=DEMO`,
  `EPOCH_LEN`, `TENOR_BLOCKS`, `START_BLOCK`. Indexer doesn't use the keys/zkeys; control does.
- `RENDER_API_KEY` lives in the root `.env`. Manage services via the REST API, e.g. create:
  ```
  POST https://api.render.com/v1/services      (Bearer $RENDER_API_KEY)
  { "type":"web_service", "name":"window-indexer", "ownerId":"tea-d9dgp6n41pts73d3ueu0",
    "image": { "ownerId":"tea-d9dgp6n41pts73d3ueu0", "imagePath":"docker.io/kaushtubh02/thewindow-backend:latest" },
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
  `VITE_CHAIN_ID=43113`, `VITE_RPC_FUJI=<public Fuji RPC>`, `VITE_INDEXER_URL=https://window-indexer-w3pv.onrender.com`,
  `VITE_CONTROL_URL=https://window-control-opuo.onrender.com`, and all `VITE_*_ADDR` from `dashboard/.env`.
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
3. **Drivers** (any `services/{keeper,agents,operator,admin,drivers}` or `services/lib` change):
   push the image (step 1) — the drivers pick it up on their **next chained GH run** (≤ ~6 h). To
   force it now: `gh run cancel` the active `fuji-drivers` run, then `gh workflow run fuji-drivers`.

## Drivers in the cloud (GitHub Actions)

The 4 autonomous drivers run 24/7 from `.github/workflows/fuji-drivers.yml` (repo must stay
**public** — free unlimited Actions minutes, 4-vCPU runners so chunked-PoCD proving matches laptop
speed; Render free instances at 0.1 CPU would take minutes per proof):

- **Chained runs**: hourly `cron: 17 * * * *` + `concurrency: fuji-drivers` (no cancel) → at most
  one active run of `timeout-minutes: 350`; the queued next run takes over within minutes of the
  previous one ending. Worst-case seam (GH cron jitter / dropped schedule) ≈ 1 h; `KEEPER_STALL_S=300`
  re-opens cleanly after any gap. Note GH auto-disables schedules after 60 days without repo activity.
- **No checkout**: the job just `docker run`s the public backend image — it already bakes the
  gitignored ABIs, `deployments/43113.json`, and zkeys that a fresh clone lacks.
- **Supervisor**: `services/drivers/index.mjs` spawns keeper/agents/operator/admin in one container
  and restarts any child that dies (drivers are stateless; chain state is the source of truth).
- **Keep-alive**: while driving, the supervisor pings the two Render `/health` URLs every 4 min
  (`KEEPALIVE_URLS`) so free-tier spin-down (15 min idle) never cold-starts a judge's first paint.
- **Secrets**: the 8 actor PKs + `AUDITOR_BJJ_*` live in GH Actions secrets (same throwaway,
  testnet-only trust class as the Render env vars).

## Free-tier reality (still important)

- Free web services **cold-start** (~30–60 s) after ~15 min idle and share a **750 instance-hours/
  month cap across the whole Render workspace** (other projects included). The driver keep-alive
  keeps indexer+control warm ~24/7 while the workflow runs — but that warmth **burns the cap**: it's
  exactly what suspended the first Render account (see the migration note up top). Watch workspace
  usage; if it suspends again, redeploy the image to yet another free account and repoint
  `dashboard/.env.production` + the workflow's `KEEPALIVE_URLS`.
- `control` is open-CORS + unauthenticated by design and holds throwaway Fuji actor keys as Render env
  secrets — acceptable for a testnet demo, **never** for real value.

## Prerequisites (one-time, before hosting)

The on-chain prereqs live in [06](06-demo-and-ops.md): `scripts/fund_fuji.mjs` (gas-fund actors),
`scripts/deploy_fuji.sh` (deploy contracts → `contracts/deployments/43113.json`),
`CHAIN_ID=43113 RPC_LOCAL=$RPC_FUJI node packages/eerc-node/src/register_all.mjs` (register members +
auditor). Those must have run before the hosted services do anything useful.
