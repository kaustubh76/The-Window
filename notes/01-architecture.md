# 01 — System Architecture

> The Window: a private machine money market on Avalanche, built on eERC (Encrypted ERC).
> **The rate is public. The borrowing never was.** Individual bid/loan sizes stay encrypted end-to-end;
> only the aggregate clearing rate (M-ONIA) is published, proven correct with a ZK
> proof-of-correct-decryption (PoCD) against the on-chain homomorphic accumulators.

This doc is the top-level map. It mirrors `the_window_architecture.excalidraw` (repo root) and links
into the detailed notes: [02-contracts](02-contracts.md), [03-circuits-and-proving](03-circuits-and-proving.md),
[04-services](04-services.md), [05-dashboard](05-dashboard.md), [06-demo-and-ops](06-demo-and-ops.md),
[07-decisions-and-gotchas](07-decisions-and-gotchas.md).

## 1. The one-paragraph pitch

Members (machine treasuries) lend and borrow against encrypted balances. Every epoch, members submit
bids/asks at **public rate ticks** with **encrypted sizes** (ElGamal over BabyJubJub, eERC's EGCT format).
The AuctionHouse contract homomorphically accumulates encrypted sizes per tick. At epoch close, the
Benchmark Administrator (holder of the eERC auditor key — the **only** plaintext surface in the system)
decrypts the per-tick aggregates off-chain, computes the uniform clearing rate r*, and posts it with a
Groth16 PoCD proving the published depth curve is the true decryption of the on-chain accumulators.
The MONIAOracle contract verifies the proof **and independently recomputes r* on-chain** — the admin
can't lie about the rate even with a valid proof. Matched loans then run a collateralized lifecycle
(solvency-proved lock → operator confirm → auditor-attested funding → repay or seize).

## 2. Component inventory

| Layer | Location | What it is |
|---|---|---|
| Contracts | `contracts/src/` | MemberRegistry, AuctionHouse, MONIAOracle, CollateralVault, LoanBook + verifier adapters; Foundry, invariant suite. See [02-contracts](02-contracts.md) |
| eERC stack | `contracts/lib/EncryptedERC/` (submodule) | TestUSDC, EncryptedERC (converter mode), Registrar, eERC Groth16 verifiers. Teardown in `spike/NOTES.md` |
| Circuits | `circuits/` | `collateral_solvency.circom`, `depth_pocd_array.circom` (**chunked**: N=10 ticks/chunk, 4 chunks cover the 37 ticks, 102 public signals each). See [03-circuits-and-proving](03-circuits-and-proving.md) |
| Node crypto | `packages/eerc-node/` | All server-side proving + ElGamal/BSGS/Poseidon helpers (`src/eerc.mjs`) |
| Services | `services/` | indexer :8787, control :8899, keeper, agents, admin, operator + shared `lib/`. See [04-services](04-services.md) |
| Dashboard | `dashboard/` | React 18 + Vite; Mock/Live adapter pattern. See [05-dashboard](05-dashboard.md) |
| Demo/ops | `demo/`, `scripts/`, `Makefile` | Scripted + autonomous runners, backend verification, local deploy. See [06-demo-and-ops](06-demo-and-ops.md) |

## 3. The three flows (no wiring gaps)

### 3.1 Read path
```
chain (Anvil/Fuji)
  → indexer (services/indexer/index.mjs, :8787) — polls events every 3s, rebuilds ALL state in memory
  → REST (/monia/*, /depth, /loans, /members, /bids, /events, /epoch/clock, /aggregates/:epoch)
  → IndexerAPI client (dashboard/src/services/indexer.ts — retry + 4s TTL cache)
  → LiveAdapter → hooks → pages
```
The indexer is deliberately stateless/persistence-free: kill it and it rebuilds from logs (crash-safe).

### 3.2 Write path
```
dashboard action
  → LiveAdapter (dashboard/src/lib/adapter/live/LiveAdapter.ts)
  → Control API (services/control/index.mjs, :8899)   ← the SINGLE write surface
  → memberops.mjs / adminops.mjs (services/lib/)
  → eerc-node proving (snarkjs, real Groth16)          ← keys & circuits live server-side ONLY
  → contract handles (services/lib/chain.mjs — cached, one NonceManager per key)
  → chain → (state re-read via the read path; loop closes)
```
The browser never holds private keys, the auditor key, or circuit artifacts.

### 3.3 Autonomous loop (no dashboard needed — `demo/run_autonomous.sh`)
```
1  keeper  → AuctionHouse.openEpoch / closeEpoch          (onlyKeeper, cron + stall-guard)
2  agents  → AuctionHouse.submitBid(tick PUBLIC, Enc(size)) per Open epoch
3  admin   ← AuctionHouse.getAggregate — Σ Enc(size) per (side, tick)
4  admin   → eerc-node: auditor decrypt + genDepthArrayProof (chunked PoCD: 4 x 10-tick proofs)
5  admin   → MONIAOracle.postPrint(r*, depth[], proofs[4]) — 4x verifier gate + on-chain r* recompute
6  admin   → LoanBook.postMatches @ r*                    → loans Pending
7  borrower→ CollateralVault.lockCollateral(Enc(c), solvency proof) → Requested   (via memberops)
8  operator→ CollateralVault.confirmLock                  → Locked   (custody EOA)
9  admin   → LoanBook.confirmFunding (checks vault.isLocked) → Active; principal/repay move as encrypted eERC transfers
10 repay → vault.release   |   past deadline: seize (permissionless) → vault.seizeTo → Defaulted
```

### 3.4 ZK verification points
| Where | Proof | Verified by |
|---|---|---|
| eERC register / wrap / unwrap / transfer | eERC prebuilt circuits (submodule artifacts) | eERC verifiers on-chain |
| `CollateralVault.lockCollateral` | CollateralSolvency: Dec(coll)·10000 ≥ Dec(loan)·12000 + key binding | SolvencyVerifierAdapter |
| `MONIAOracle.postPrint` | DepthPoCDArray **chunked**: 4 proofs × 102 public signals, each bound to its 10-tick slice of on-chain accumulators + auditor key (cross-chunk swaps fail) | DepthPoCDArrayVerifier via PoCDVerifierAdapter (17,892 B deployed — **EIP-170-compliant, deploys inline**; live on Fuji) |

## 4. Trust model & leak budget (honest-claim guardrail)

- **Hidden:** all amounts (bid sizes, loan sizes, collateral, balances) — ElGamal EGCT ciphertexts.
- **Visible:** member addresses, rate ticks chosen, event timing, loan lifecycle transitions.
- **Never claim "undecryptable":** the auditor key CAN decrypt everything. The claim is
  *accountable privacy* — decryption is confined to one keyholder whose published output (the depth
  curve and r*) is forced honest by the PoCD + on-chain clearing recompute.
- **Auditor-attested funding:** eERC `PrivateTransfer` carries no plaintext amount, so LoanBook
  funding/repayment cannot be verified trustlessly on-chain; `confirmFunding`/`repay` are
  `onlyAdmin` attestations (see METHODOLOGY.md "trusted surfaces" and [07-decisions-and-gotchas](07-decisions-and-gotchas.md)).
- **Vault = authority, not custody:** encrypted balances can't be custodied by a contract without its
  own BJJ key, so a Vault Operator EOA does real escrow behind the two-step
  `lockCollateral → confirmLock` state machine.
- **Plaintext surface:** exactly one — `services/lib/adminops.mjs` running with `AUDITOR_BJJ_PRIV`.

## 5. Ports, chains, profiles

| Thing | Value |
|---|---|
| Indexer | `:8787` (`INDEXER_PORT`) |
| Control API | `:8899` (`CONTROL_PORT`) |
| Local chain | Anvil (vanilla — no code-size flag needed), chainId 31337, addresses in `contracts/deployments/31337.json` |
| Testnet | Fuji, chainId 43113 (`RPC_FUJI`) — **DEPLOYED AND LIVE**: addresses in `contracts/deployments/43113.json`, run via `demo/run_fuji.sh` (see [06-demo-and-ops](06-demo-and-ops.md)) |
| PROFILE | `DEMO` (seconds-scale epochs) / `PROD` (1h epochs) — plumbed .env → `DeployAll.s.sol` → indexer `/epoch/clock` → dashboard `TIME_PROFILES` |

## 6. Actors

| Actor | Key material | Role |
|---|---|---|
| lender1 / lender2 (+ agent4/agent5 sims) | own BJJ keypairs + EOAs | encrypted asks/bids |
| Borrower (Mission Control) | BJJ keypair + EOA | borrows, locks encrypted collateral, solvency proof |
| Benchmark Administrator | eERC **auditor** BJJ key + admin EOA | decrypts aggregates, prints M-ONIA, attests funding |
| Keeper | EOA | epoch clock + seize |
| Vault Operator | EOA | real escrow; `confirmLock` |
| Public / Judge | none | sees `RatePrinted` + ciphertexts only |

Registry with all keys/scalars: `services/lib/actors.mjs` (Anvil defaults, env-overridable).

## 7. Where the diagram lives

`the_window_architecture.excalidraw` at repo root — regenerated 2026-07-11 to match the post-Control-API
implementation (lanes: Actors | Dashboard | Off-chain services | On-chain; bands: Circuits, Demo/Ops;
numbered arrows R1–R2 read path, W1–W4 write path, 1–10 autonomous loop, plus internal on-chain and
artifact wiring). Diagram-sync status (verified 2026-07-12): the diagram ALREADY reflects the chunked
PoCD (4 × 102-signal proofs, 17.9 KB verifier) and the live Fuji deployment; the last two stale labels
(`run_demo.sh` "code-size 200k", monolith-era `_buildPublicSignals`) were fixed in the pre-submission
hardening pass. If you change the architecture, regenerate/update the diagram AND this file.
Note: `Readme.md` §5 still contains the pre-Control-API ASCII diagram (known drift — see
[07-decisions-and-gotchas](07-decisions-and-gotchas.md)).
