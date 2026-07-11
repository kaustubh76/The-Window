# notes/ — Implementation Documentation Index

Comprehensive, source-verified documentation of THE WINDOW as **implemented** (written 2026-07-11,
current through the chunked-PoCD + Fuji work following commit `c2200aa`). Use this folder as context
for future development — every doc cites real file paths and was verified against source, not against
the original plan.

> **The stack is LIVE on Avalanche Fuji (chainId 43113)** — chunked 4×102-signal PoCD verifier
> (EIP-170-compliant, 17,892 B), addresses in `contracts/deployments/43113.json`, services run via
> `demo/run_fuji.sh`. See [06-demo-and-ops](06-demo-and-ops.md) → "Fuji deployment".

## The notes

| Doc | Covers |
|---|---|
| [01-architecture.md](01-architecture.md) | Top-level map: components, the three flows (read / write / autonomous loop), ZK verification points, trust model & leak budget, actors, ports/profiles. Mirrors `the_window_architecture.excalidraw`. |
| [02-contracts.md](02-contracts.md) | All six contracts (MemberRegistry, MemberGated, AuctionHouse, MONIAOracle, CollateralVault, LoanBook) — state, functions, access control, events, inter-contract wiring; verifier layer; DeployAll; full test/invariant suite. |
| [03-circuits-and-proving.md](03-circuits-and-proving.md) | CollateralSolvency (11 public signals) & DepthPoCDArray (**chunked**: N=10, 4 chunks × 102 signals, order coupled to `MONIAOracle._buildChunkSignals`); build scripts & artifacts; the full post-refactor `packages/eerc-node` API; support scripts. |
| [04-services.md](04-services.md) | `services/lib/` (chain/actors/memberops/adminops) + the six runnables. **Full route tables** for Indexer :8787 and Control :8899 with handlers and request bodies. Security/trust model. |
| [05-dashboard.md](05-dashboard.md) | Adapter pattern, LiveAdapter method→HTTP-route mapping, MockAdapter/DemoEngine, config & TIME_PROFILES, routes + RoleGate, hooks & stores, env plumbing. |
| [06-demo-and-ops.md](06-demo-and-ops.md) | run_demo.sh vs run_autonomous.sh vs **run_fuji.sh**, scenario.mjs, verify_backend.mjs, smoke_member.mjs, deploy_local.sh (vanilla Anvil — no code-size hacks), **the live Fuji deployment** (fund_fuji.mjs / deploy_fuji.sh / addresses / timing), Makefile targets, PROFILE plumbing, **full env-var reference**, how to run everything. |
| [07-decisions-and-gotchas.md](07-decisions-and-gotchas.md) | Every non-obvious decision with Why/Where: auditor-attested funding, vault-operator custody, two ElGamal decrypt conventions, 102-signal-per-chunk coupling, on-chain clearing recompute, NonceManager sharing, the **resolved** chunked-PoCD EIP-170 story, doc-drift list. |

The architecture diagram at the repo root (`the_window_architecture.excalidraw`) was regenerated
2026-07-11 to match the post-Control-API implementation — numbered arrows: R1–R2 read path,
W1–W4 write path, 1–10 autonomous loan loop, plus on-chain internal and circuit/artifact wiring.

## Other documentation in the repo — freshness map

| Doc | Status | Notes |
|---|---|---|
| `METHODOLOGY.md` | ✅ Current | M-ONIA methodology + trusted/accountable surfaces; already reflects the two-step vault lock and auditor-attested funding. |
| `ROADMAP.md` | ✅ Current | Out-of-scope list; stable. |
| `spike/GATE.md` | ⚠️ Mostly current | D2 gate decision (homomorphic accumulation + PoCD validated, no commit-reveal pivot). ⚠️ Reproduce commands reference deleted `gen_pocd_input.mjs`/`elgamal.mjs`; ⚠️ still describes the **372-signal monolithic PoCD** — superseded by the chunked 4×102 design. |
| `spike/NOTES.md` | ⚠️ Mostly current | Best eERC teardown (ciphertext layout, auditor mechanics, converter quirks). ⚠️ Names deleted `gen_pocd_input.mjs`/`elgamal.mjs`/`decryptPCT` (removed in `8e9db63` — use `userFromRaw`/`genWithdrawProof`/`decryptEGCT*` in `eerc.mjs`); ⚠️ claims dashboard uses `@avalabs/eerc-sdk` v1.0.2 — it is NOT in `dashboard/package.json`; ⚠️ §"EIP-170" (NOTES.md:83-87) still describes the **372-signal monolith + cast pre-deploy + deferred bid/ask-split plan** — resolved by the implemented chunking (see 07). |
| `Readme.md` | ⚠️ Stale in parts | The original up-front spec — still the best narrative/pitch. ⚠️ §5 ASCII diagram predates the Control-API architecture; §9 says solidity `^0.8.24` (pinned is 0.8.27); §15's EIP-170 mitigation ("split into bid/ask proofs") is superseded by the **implemented** 10-tick chunking; many `[TO-VERIFY]` markers since resolved by `spike/NOTES.md`; no Control API / autonomous runner / two-step lock. |
| `dashboard/README.md` | ⚠️ Stale write-path | Adapter description is good, but says LiveAdapter writes are "Pending (EercNotReady)" — superseded by `15b508e`: all writes wired through Control API :8899. |

Full drift details (with line numbers) live in [07-decisions-and-gotchas.md](07-decisions-and-gotchas.md).

## Quick orientation for a new session

1. Read [01-architecture.md](01-architecture.md) first (5 min).
2. Touching contracts/circuits → 02 + 03. Touching services/API → 04. Touching UI → 05. Running things → 06.
3. Before changing anything non-obvious, scan [07-decisions-and-gotchas.md](07-decisions-and-gotchas.md) — several couplings (signal ordering, decrypt conventions, nonce management) break silently.
4. Keep this folder honest: if you change the architecture, update the affected note, the excalidraw diagram, and 01.
