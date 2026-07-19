# notes/ — Implementation Documentation Index

Comprehensive, source-verified documentation of THE WINDOW as **implemented** (written 2026-07-11;
last verified + updated 2026-07-12 in the **pre-submission hardening pass**: a three-agent audit
cross-checked every doc against source AND probed the live Fuji/Render/Vercel deployment read-only —
all audit findings were fixed in code/docs the same day). Use this folder as context for future
development — every doc cites real file paths and was verified against source, not against the
original plan.

> **The stack is LIVE on Avalanche Fuji (chainId 43113) AND hosted publicly.**
> - On-chain: chunked 4×102-signal PoCD verifier (EIP-170-compliant, 17,892 B), addresses in
>   `contracts/deployments/43113.json`.
> - Public app: frontend on **Vercel → https://the-window-five.vercel.app**, `indexer`+`control`
>   on **Render** (`window-indexer-w3pv` / `window-control-opuo`.onrender.com) from a Docker image;
>   the four autonomous drivers run **24/7 on GitHub Actions** (`.github/workflows/fuji-drivers.yml`),
>   NOT the local Mac (`demo/run_fuji.sh` is local-dev only). See
>   [08-hosting-and-deployment](08-hosting-and-deployment.md).
> - The dashboard now shows **real Fuji transactions with Snowtrace links** (a "Live on-chain
>   activity" feed + per-event/toast tx links), and the sim-agents randomize bids each epoch.

## The notes

| Doc | Covers |
|---|---|
| [01-architecture.md](01-architecture.md) | Top-level map: components, the three flows (read / write / autonomous loop), ZK verification points, trust model & leak budget, actors, ports/profiles. Mirrors `the_window_architecture.excalidraw`. |
| [02-contracts.md](02-contracts.md) | All six contracts (MemberRegistry, MemberGated, AuctionHouse, MONIAOracle, CollateralVault, LoanBook) — state, functions, access control, events, inter-contract wiring; verifier layer; DeployAll; full test/invariant suite. |
| [03-circuits-and-proving.md](03-circuits-and-proving.md) | CollateralSolvency (11 public signals) & DepthPoCDArray (**chunked**: N=10, 4 chunks × 102 signals, order coupled to `MONIAOracle._buildChunkSignals`); build scripts & artifacts; the full post-refactor `packages/eerc-node` API; support scripts. |
| [04-services.md](04-services.md) | `services/lib/` (chain/actors/memberops/adminops) + the six runnables. **Full route tables** for Indexer :8787 and Control :8899 with handlers and request bodies. Security/trust model. |
| [05-dashboard.md](05-dashboard.md) | Adapter pattern (live-only), LiveAdapter method→HTTP-route mapping, config & TIME_PROFILES, routes + RoleGate, hooks & stores, env plumbing. |
| [06-demo-and-ops.md](06-demo-and-ops.md) | run_demo.sh vs run_autonomous.sh vs **run_fuji.sh**, scenario.mjs, verify_backend.mjs, smoke_member.mjs, deploy_local.sh (vanilla Anvil — no code-size hacks), **the live Fuji deployment** (fund_fuji.mjs / deploy_fuji.sh / addresses / timing), Makefile targets, PROFILE plumbing, **full env-var reference**, how to run everything. |
| [07-decisions-and-gotchas.md](07-decisions-and-gotchas.md) | Every non-obvious decision with Why/Where: auditor-attested funding, vault-operator custody, two ElGamal decrypt conventions, 102-signal-per-chunk coupling, on-chain clearing recompute, NonceManager sharing, the **resolved** chunked-PoCD EIP-170 story, **cloud-hosting gotchas (Render/Docker/Vercel)**, doc-drift list. |
| [08-hosting-and-deployment.md](08-hosting-and-deployment.md) | **Public cloud deployment**: Vercel (prebuilt static frontend) + Render free-tier `indexer`/`control` web services from a Docker Hub image + the four **drivers 24/7 on GitHub Actions**; live URLs + service IDs (incl. the Render account migration), the `Dockerfile`/`.dockerignore` design, Render/Vercel/CI config, and the **redeploy runbook**. |
| [09-permissioned-l1.md](09-permissioned-l1.md) | **The implemented D7 stretch**: sovereign local L1 `thewindowl1` (43117, Subnet-EVM) with the TxAllowList precompile synced from MemberRegistry by `services/allowlist` — membership IS chain access. Genesis, keeper design, bootstrap ordering, `run_l1.sh`/`verify_l1_allowlist.mjs`, verified-run record. |

The architecture diagram at the repo root (`the_window_architecture.excalidraw`) is
**script-generated** by `scripts/regen_architecture_diagram.py` (reads the hand-authored
`the_window_architecture.base.excalidraw`, writes the canonical file; validate with
`scripts/check_diagram_overlaps.py`). It shows: numbered arrows R1–R2 read / W1–W4 write / 1–10
autonomous loan loop + on-chain internal + circuit/artifact wiring, a **HOSTING & AUTOMATION** band
(Vercel · Render indexer/control · Docker Hub · GitHub Actions drivers · Fuji), a color legend, and a
**"why this wins a speedrun"** callout.

## Other documentation in the repo — freshness map

| Doc | Status | Notes |
|---|---|---|
| `METHODOLOGY.md` | ✅ Current | M-ONIA methodology + trusted/accountable surfaces; already reflects the two-step vault lock and auditor-attested funding. |
| `ROADMAP.md` | ✅ Current | Out-of-scope list; stable. |
| `spike/GATE.md` | ⚠️ Mostly current | D2 gate decision (homomorphic accumulation + PoCD validated, no commit-reveal pivot). ⚠️ Reproduce commands reference deleted `gen_pocd_input.mjs`/`elgamal.mjs`; ⚠️ still describes the **372-signal monolithic PoCD** — superseded by the chunked 4×102 design. |
| `spike/NOTES.md` | ⚠️ Mostly current | Best eERC teardown (ciphertext layout, auditor mechanics, converter quirks). ⚠️ Names deleted `gen_pocd_input.mjs`/`elgamal.mjs`/`decryptPCT` (removed in `8e9db63` — use `userFromRaw`/`genWithdrawProof`/`decryptEGCT*` in `eerc.mjs`); ⚠️ claims dashboard uses `@avalabs/eerc-sdk` v1.0.2 — it is NOT in `dashboard/package.json`; ⚠️ §"EIP-170" (NOTES.md:83-87) still describes the **372-signal monolith + cast pre-deploy + deferred bid/ask-split plan** — resolved by the implemented chunking (see 07). |
| `Readme.md` | ✅ Current (2026-07-12) | The original up-front spec + narrative/pitch, refreshed in the hardening pass: new §0 **LIVE DEPLOYMENT** (Fuji addresses + Snowtrace links + hosted URLs), §5 diagram marked superseded → points at notes/01, §9 notes the 0.8.27 pin, §15 records the implemented chunking outcome, every `[TO-VERIFY]` resolved inline. |
| `dashboard/README.md` | ✅ Current (2026-07-12) | LiveAdapter section rewritten: all writes via Control API (real proofs server-side, txHash+gasUsed back), no-silent-mock-fallback stated, hosted-app note added. |

Full drift details (with line numbers) live in [07-decisions-and-gotchas.md](07-decisions-and-gotchas.md).

## Quick orientation for a new session

1. Read [01-architecture.md](01-architecture.md) first (5 min).
2. Touching contracts/circuits → 02 + 03. Touching services/API → 04. Touching UI → 05. Running things locally → 06. **Deploying / the hosted app → 08.**
3. Before changing anything non-obvious, scan [07-decisions-and-gotchas.md](07-decisions-and-gotchas.md) — several couplings (signal ordering, decrypt conventions, nonce management) break silently.
4. Keep this folder honest: if you change the architecture, update the affected note, the excalidraw diagram, and 01.
