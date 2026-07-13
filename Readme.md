# THE WINDOW — Private Machine Money Market on Avalanche (eERC)

> **The rate is public. The borrowing never was.**
> An hourly uniform-price auction over **encrypted** bid sizes discovers M-ONIA — the Machine Overnight Index Average — the first benchmark rate for the agent economy, printed on-chain with a proof of correct decryption. Individual loans, collateral, and repayments settle as encrypted eERC transfers. Observable borrowing kills lending markets (discount-window stigma; see §2); THE WINDOW is a money market that can only exist in ciphertext.

**Hackathon:** Avalanche Privacy Hackathon (Team1, India-only) · **Deadline:** July 19, 2026, 3:29 AM IST · **Judging:** value proposition, technical complexity, usage of Avalanche technologies · **Bonus:** eERC running on a permissioned L1 (D7 stretch goal, §12).

This README is the original build spec (written up-front, executed by an AI coding agent with a human operator "K"). **The build is complete and LIVE** — for documentation of the system *as implemented*, see [`notes/`](notes/00-INDEX.md) (source-verified, kept current); where this README and `notes/` disagree, `notes/` wins.

---

## 0. LIVE DEPLOYMENT (Avalanche Fuji, chainId 43113)

The full stack is deployed and running autonomously on the real Fuji testnet — real chunked Groth16 PoCD verified on-chain on every M-ONIA print (~4.4M gas), complete loan lifecycles including default → seize, no mocks anywhere in the live path.

**Hosted app:** https://the-window-five.vercel.app (frontend, Vercel) → `window-indexer` / `window-control` .onrender.com (backend, Render) → Fuji. The four autonomous drivers run 24/7 in the cloud (chained GitHub Actions jobs — `.github/workflows/fuji-drivers.yml`, `notes/08`), so the auction advances with no local machine involved; `demo/run_fuji.sh` remains the local-dev driver path.

| Contract | Fuji address |
|---|---|
| TestUSDC | [`0x69FeBF0674ffea0ddf6BbFaD554582d9e5DB0bCF`](https://testnet.snowtrace.io/address/0x69FeBF0674ffea0ddf6BbFaD554582d9e5DB0bCF) |
| EncryptedERC (converter) | [`0xa3F9e88dfFd25ceb64dc040498c9F2Ce50f8C0a2`](https://testnet.snowtrace.io/address/0xa3F9e88dfFd25ceb64dc040498c9F2Ce50f8C0a2) |
| Registrar | [`0x6603f2485B9B5d8c705400abF7241D4f9e183bF9`](https://testnet.snowtrace.io/address/0x6603f2485B9B5d8c705400abF7241D4f9e183bF9) |
| MemberRegistry | [`0x14c8173279FB3F28B6fE9b0423Ff535C0cBaD7F8`](https://testnet.snowtrace.io/address/0x14c8173279FB3F28B6fE9b0423Ff535C0cBaD7F8) |
| AuctionHouse | [`0xd001d287d7e62fE1118C42E49E3fe461e010a71e`](https://testnet.snowtrace.io/address/0xd001d287d7e62fE1118C42E49E3fe461e010a71e) |
| MONIAOracle | [`0xD1979c145d70009e6D84AB82A590E13a0026CEc2`](https://testnet.snowtrace.io/address/0xD1979c145d70009e6D84AB82A590E13a0026CEc2) |
| CollateralVault | [`0x9C948B4dA40F017102dAAe78afd956829E32d05e`](https://testnet.snowtrace.io/address/0x9C948B4dA40F017102dAAe78afd956829E32d05e) |
| LoanBook | [`0x42215B392c3C22Af3fbBE45d370114C43F536031`](https://testnet.snowtrace.io/address/0x42215B392c3C22Af3fbBE45d370114C43F536031) |
| DepthPoCDArrayVerifier (chunked PoCD, 17,892 B — under EIP-170) | [`0x71548d2B3CEE856E17315e2E286491233E571E75`](https://testnet.snowtrace.io/address/0x71548d2B3CEE856E17315e2E286491233E571E75) |

Machine-readable: [`contracts/deployments/43113.json`](contracts/deployments/43113.json); deployment tx provenance (20 txs, blocks 56,937,681–716): `contracts/broadcast/DeployAll.s.sol/43113/run-latest.json`. Live Fuji parameters: `EPOCH_LEN=120` s, `TENOR_BLOCKS=60` (see `notes/06`).

**Bonus track — permissioned L1 (implemented):** the full stack also runs on a sovereign Avalanche L1 (`thewindowl1`, chainId 43117, Subnet-EVM) where **MemberRegistry membership IS chain access** — a keeper syncs the `TxAllowList` precompile from membership events, so non-members cannot transact at all. Reproduce with `avalanche-cli` + [`demo/run_l1.sh`](demo/run_l1.sh); design + verified run in [`notes/09-permissioned-l1.md`](notes/09-permissioned-l1.md).

---

## 1. Non-negotiable rules for the coding agent

1. **Verify-first.** Anything marked `[TO-VERIFY]` is an assumption, not a fact. Before building on it, read the actual source: the `ava-labs/EncryptedERC` GitHub repo (contracts + circuits), the official eERC docs/SDK (verify the exact npm package name — do not guess it), and the Avalanche Builder Hub eERC course materials. Never invent an eERC function signature, struct layout, or SDK method. If the source contradicts this README, the source wins — then update this README. *(Status: every `[TO-VERIFY]` below has since been RESOLVED by the D1 eERC teardown — resolutions are annotated inline; full detail in `spike/NOTES.md` and `notes/07`.)*
2. **Gates are hard stops.** The D2 gate (§8) decides the entire architecture. Do not write AuctionHouse's homomorphic path before the gate passes. If the gate fails, execute the pivot spec (§8.4) the same day without re-litigating the decision.
3. **Honest claims only** — in code comments, README copy, dashboard text, and pitch material. The privacy model in §4 is the *only* set of claims this project makes. Specifically: **never** write "undecryptable," "trustless," or "nobody can see the bids." The auditor/administrator CAN decrypt individual amounts under eERC. That is the documented, SOFR-style trust model — state it proudly, never hide it.
4. **Scope discipline.** The de-scoped spec in this document is final for the hackathon. Do not add: variable haircut schedules, receivables collateral, multi-asset support, secondary loan markets, term (non-overnight) tenors, or governance tokens. Each appears in ROADMAP.md only.
5. **Ship small versions early.** Every phase ends with something runnable end-to-end, even if ugly. A 70%-finished ambitious build reads as broken to speedrun judges; a finished small build wins.
6. **Foundry tests are written with the contract, not after.** Invariant targets are listed in §11 and are part of the definition of done.
7. **Demo mode is a first-class config.** Every time constant (epoch length, loan tenor) reads from config with a `DEMO` profile (seconds) and a `PROD` profile (hours). Never hardcode durations.

---

## 2. Why this exists (the pitch, for context)

The most documented pathology in monetary economics is that **observable borrowing kills lending markets**. In 2008, banks paid above the Fed's discount-window rate in the interbank market rather than be *seen* borrowing from the window — the stigma signal costs more than the funding. Dodd-Frank mandates a two-year lag on disclosing discount-window borrowers for exactly this reason.

Port that to a public chain: an AI agent that borrows overnight working capital broadcasts "I am short" to every counterparty in real time. Suppliers reprice it, lenders quote it wider next auction, competitors front-run it. Rational agents therefore never borrow — they overfund every wallet (dead capital) — and the machine money market fails to form. On a transparent chain this product is not worse; it is **impossible**.

THE WINDOW inverts the transparency: individual positions are ciphertext, and the *aggregate* — the clearing rate — is the public good. That is exactly how SOFR works: confidential transaction reporting in, public benchmark out. Privacy here is not a feature; it is the precondition for price discovery.

---

## 3. Product specification

### 3.1 Actors

| Actor | Role | Keys |
|---|---|---|
| Lender agents | Idle treasury float seeking overnight yield | Own EOA + registered BabyJubJub keypair |
| Borrower agents (demo: "Mission Control") | Need short-tenor working capital | Own EOA + registered BabyJubJub keypair |
| Benchmark Administrator | Holds the eERC **auditor** key; decrypts per-tick aggregates; computes clearing + matching; posts M-ONIA with proof of correct decryption. Accountable, rotatable role (✅ verified: eERC supports auditor key rotation — `setAuditorPublicKey`, spike/NOTES.md) | Auditor keypair |
| Keeper | Permissionless bot: closes epochs, triggers seizures at deadline blocks | EOA |
| Public / judges | See M-ONIA prints, aggregate depth, and raw ciphertexts on the explorer | None |

### 3.2 Core lifecycle (one epoch)

1. **Bid.** During epoch `t`, members submit bids to `AuctionHouse`: lenders submit **asks** `(rateTick PUBLIC, Enc(size), fundsProof)`, borrowers submit **bids** `(rateTick PUBLIC, Enc(size), collateralCommitment)`. Rate ticks are public (a rate leaks almost nothing); **sizes are eERC ciphertexts**. The contract homomorphically accumulates `Σ Enc(size)` per tick per side.
2. **Close.** Keeper calls `closeEpoch(t)` after the epoch window. No new bids accepted.
3. **Print.** Administrator service reads the per-tick aggregate ciphertexts, decrypts with the auditor key, computes the uniform clearing rate `r*` (supply/demand crossing), generates a **proof of correct decryption (PoCD)** over the aggregates, and calls `MONIAOracle.postPrint(t, r*, depthCurve, pocdProof)`. The contract verifies the proof and emits `RatePrinted`. **M-ONIA is born.**
4. **Match.** Administrator posts the match set to `LoanBook` (admin-as-matching-engine is an explicit, honest design decision — see §3.4). Each match creates a loan record: `(lender, borrower, r*, tenor, deadlineBlock)` with **no plaintext size on-chain**.
5. **Collateralize.** Borrower locks encrypted collateral in `CollateralVault` with a **solvency proof**: a Groth16 proof that `Dec(collateral) ≥ h × Dec(loanSize)` for fixed haircut `h = 120%`, without revealing either value.
6. **Fund.** Lender executes an eERC encrypted transfer of principal to borrower, referencing the loanId. *(✅ resolved: eERC's `PrivateTransfer` event carries NO plaintext amount, so a third-party contract cannot verify transfer magnitude trustlessly — funding/repayment are **auditor-attested**: the admin decrypts the transfer's auditorPCT off-chain and calls `LoanBook.confirmFunding`/`repay` (`onlyAdmin`). Documented as a trusted surface in METHODOLOGY.md §5 and notes/07.)*
7. **Repay or seize.** Before `deadlineBlock`: borrower transfers `Enc(principal + interest)` back → LoanBook marks repaid → Vault releases collateral. After `deadlineBlock` with no repayment: keeper calls `seize(loanId)` → Vault reassigns the encrypted collateral claim to the lender.

### 3.3 Fixed parameters (do not make configurable beyond DEMO/PROD)

| Parameter | PROD | DEMO |
|---|---|---|
| Epoch length | 1 hour | 60 s |
| Loan tenor | 6 hours (overnight-style) | 5 min |
| Rate band | 1.00%–10.00% annualized | same |
| Tick size | 25 bps | same |
| Haircut `h` | 120% (fixed) | same |
| Settlement asset | eERC-wrapped TestUSDC (converter mode) | same |
| Min bid size | 10 USDC | 1 USDC |

### 3.4 Explicit design decisions (do not re-open)

- **Admin-as-matching-engine.** Under eERC, amounts are encrypted to the owner AND the auditor. The administrator can already decrypt individual bids; pretending otherwise would be theater. Therefore the admin service computes fills off-chain and posts them. The on-chain guarantees are: (a) the *public* only ever learns aggregates + the rate, (b) the PoCD proves the published depth curve is the true decryption of the on-chain ciphertext accumulators, (c) collateral sufficiency is proven in zero knowledge, (d) settlement finality is contract-enforced. This is the SOFR model: confidential inputs, accountable administrator, public benchmark.
- **Cash-secured only.** Collateral is encrypted wrapped-USDC. No receivables, no price oracles, no liquidation engine — a missed deadline block is the only default condition, and seizure is deterministic.
- **Uniform-price auction.** All fills clear at `r*`. Pro-rata allocation at the marginal tick is computed by the admin service; document it in the methodology page.
- **Both sides bid.** Lenders set minimum acceptable rate; borrowers set maximum. `r*` = crossing of cumulative (decrypted, aggregate) supply and demand curves. If curves don't cross, epoch prints "no trade" and M-ONIA carries the last print (flagged stale on dashboard).

---

## 4. Privacy model — the honest leak budget

**Hidden from the public:** bid sizes, loan sizes, collateral amounts, repayment amounts, every account's encrypted balance, and any individual's borrowing *history* (the sequence — arguably the most valuable secret).

**Visible to the public:** rate ticks bid at (not by whom at what size), member addresses (eERC hides amounts, **not** sender/receiver addresses — say this before a judge does), epoch timing, M-ONIA prints, aggregate depth per tick, loan *count* and lifecycle events (not sizes), seizure events (not amounts).

**Visible to the Administrator:** everything, by decryption under the auditor key. Mitigations: the role is (a) contractually bound to publish only aggregates, (b) auditable — every print carries a PoCD, (c) rotatable via eERC auditor key rotation (✅ verified — `setAuditorPublicKey`, spike/NOTES.md). This is a *trusted, accountable* role, analogous to a benchmark administrator (cf. ICE Benchmark Administration) — never claim otherwise.

**Known non-goals:** receipt-freeness (a member can voluntarily decrypt to prove their own bid), timing-analysis resistance (bid submission timing is public), and network-level privacy.

---

## 5. Architecture (original design sketch)

> ⚠️ **Superseded by the implemented architecture.** This ASCII sketch predates the build: the "eERC TS SDK" client layer was replaced by the **Control API** (`services/control`, :8899) — the browser holds no keys and generates no proofs; all writes go dashboard → Control API → server-side proving (`packages/eerc-node`) → chain. The current, accurate map is [`notes/01-architecture.md`](notes/01-architecture.md) and `the_window_architecture.excalidraw`. The trust-boundary statement below still holds.

```
ACTORS                CLIENT LAYER                    ON-CHAIN (Fuji)                     OFF-CHAIN
──────                ────────────                    ───────────────                     ─────────
Lender ──keygen──▶ eERC TS SDK ──1 register──▶ Registrar (eERC)                      Keeper bot
Borrower ─────────▶   │        ──2 wrap──────▶ EncryptedERC (converter) ◀─verify─ Groth16 Verifiers
Admin (auditor key)   │                              │                                    │
                      ├─3 submitBid(tick, Enc(size), proof)──▶ AuctionHouse ◀─4 closeEpoch┘
                Circuit 1: CollateralSolvency              │ Σ Enc(size)/tick
                Circuit 2: DepthCurve PoCD                 ├──5 read aggregates──▶ Admin service
                      │                                    │                        │ decrypt+PoCD
                      │                             MONIAOracle ◀──6 postPrint(r*, depth, proof)
                      │                                    │──7 fills @ r*──▶ LoanBook
                      └─8 lockCollateral(Enc(c), solvencyProof)──▶ CollateralVault ◀─10 release
                                                    EncryptedERC ◀─9 principal/repay transfers
                                                    LoanBook ◀──11 seize() @ deadline── Keeper
                MONIAOracle ──12 RatePrinted──▶ Indexer ──13──▶ Ticker + Depth chart
                EncryptedERC ──14 ciphertext view──▶ Explorer split-screen (the demo closer)
```

Trust boundary: **arrow 5→6** is the only place plaintext exists (inside the admin service). Keep that surface minimal — the admin service must never write plaintext sizes to logs, DB, or API responses.

---

## 6. Repository layout

```
the-window/
├── README.md                  # this file
├── ROADMAP.md                 # everything out of scope (L1 prod, term markets, MM strategy…)
├── METHODOLOGY.md             # M-ONIA methodology: auction spec, PoCD, leak budget (§4 verbatim)
├── contracts/                 # Foundry project
│   ├── src/
│   │   ├── MemberRegistry.sol
│   │   ├── AuctionHouse.sol
│   │   ├── MONIAOracle.sol
│   │   ├── CollateralVault.sol
│   │   ├── LoanBook.sol
│   │   └── verifiers/         # exported verifier.sol per circuit (generated)
│   ├── test/                  # unit + invariant suites (§11)
│   └── script/                # deploy scripts (Fuji + local L1 profiles)
├── circuits/
│   ├── collateral_solvency/   # Circuit 1 (circom)
│   ├── depth_pocd/            # Circuit 2 (circom)
│   └── build/                 # ptau, zkeys, artifacts (gitignore large files; script the build)
├── services/
│   ├── admin/                 # decrypt aggregates, clearing, matching, PoCD gen, postPrint
│   ├── keeper/                # closeEpoch cron + deadline watcher
│   ├── agents/                # scripted heterogeneous bidder bots (disclosed as simulation)
│   └── indexer/               # event listener → SQLite/JSON → REST API
├── dashboard/                 # M-ONIA ticker, depth chart, explorer split-screen (React/Vite)
├── spike/                     # D1–D2 gate artifacts: eERC teardown notes, toy accumulator
└── demo/                      # demo script, seeded scenario, video assets, pitch deck
```

---

## 7. Phase 0 — Environment (do first, ~1 hour)

Install and pin: Foundry (latest), Node 20+, `circom` 2.x, `snarkjs`, `avalanche-cli` (for D7 stretch). Configure Fuji: RPC `https://api.avax-test.network/ext/bc/C/rpc`, chainId 43113, faucet AVAX for 4+ test EOAs (lender ×2, borrower, admin, keeper). Create `.env.example` with every variable any service reads. *(✅ resolved: the browser never got an eERC SDK — all proving runs server-side in `packages/eerc-node` (snarkjs + the protocol's own libraries), and the dashboard writes via the Control API. See notes/04/05.)*

---

## 8. Phase 1–2 (D1–D2): eERC teardown + THE GATE

### 8.1 D1 — teardown checklist (output: `spike/NOTES.md`)

Clone `ava-labs/EncryptedERC`. Answer each question **with file/line citations**:

1. Exact on-chain ciphertext representation of an encrypted amount (ElGamal over BabyJubJub — how many field elements, what struct, how stored per account).
2. Registration flow: what proof `Registrar` requires, how the SDK generates it.
3. Converter mode: deposit/withdraw call sequence for wrapping an ERC-20; decimals handling.
4. Auditor mechanics: how amounts are encrypted to the auditor key; whether key rotation exists; what the auditor can and cannot decrypt.
5. Transfer flow: what a third-party contract can observe (events, return data) to confirm "lender paid borrower loan X" — this determines LoanBook's funding hook.
6. Whether ciphertexts for a given owner can be **added by an external contract** (BabyJubJub point addition in Solidity): are curve-add precompiles/libraries present in the repo? Gas cost per addition?
7. Proof generation latency: measure register/transfer proof times on K's machine. Record numbers — they go on a pitch slide as honesty, not shame.

End of D1: registration + wrap + one encrypted transfer working on Fuji via the SDK, scripted and committed.

### 8.2 D2 — THE GATE (hard stop)

Build in `spike/` only:

- **Toy accumulator contract:** accepts two eERC-format ciphertexts encrypted to the same (auditor) key, stores `C_sum = C_1 ⊕ C_2` via on-chain BabyJubJub point addition.
- **PoCD circuit v0:** public inputs `(C_sum, claimedSum, auditorPubKey)`, private input `auditorPrivKey`; constraint: `Dec(auditorPrivKey, C_sum) == claimedSum` and the privkey corresponds to the pubkey. Compile, ceremony (small ptau fine for hackathon), export verifier.sol, deploy, verify one proof on-chain.

**PASS =** valid PoCD for an on-chain homomorphic sum verifies on Fuji, and per-addition gas is sane (<~500k `[measure]`). → Build the full spec.
**FAIL =** any of: external contracts can't perform the point addition affordably, ciphertext encoding blocks aggregation, PoCD circuit exceeds ~2 days of debugging runway. → Pivot **same day**:

### 8.4 Pivot spec (commit-reveal fallback — pre-authorized, no discussion needed)

AuctionHouse becomes commit-reveal: bidders commit `hash(tick, size, salt)` during the epoch, reveal `(tick, size, salt)` **directly to the admin service over an encrypted channel** (never on-chain), admin posts `r*` + aggregate depth + a signed attestation (no PoCD). Collateral still uses Circuit 1 (the solvency proof is independent of the gate). Settlement still uses encrypted eERC transfers. The stigma narrative, M-ONIA, and 80% of the codebase survive; only the "homomorphic accumulation + PoCD" slide is replaced by "administrator attestation (roadmap: PoCD)." Honest framing required in all copy.

---

## 9. Phase 3 (D3–D5): contracts

All contracts: Solidity pragma ^0.8.24 (toolchain pinned to **solc 0.8.27** in `contracts/foundry.toml`, matching the eERC submodule), Foundry, custom errors, events for every state transition, `onlyMember` where noted. No upgradeability, no proxies (hackathon).

### 9.1 MemberRegistry
State: `mapping(address => Member { bool active; uint64 joinedEpoch; bytes32 bjjPubKeyRef })`. Admin-gated `addMember/removeMember`. Modifier `onlyMember` consumed by AuctionHouse, LoanBook, Vault. This contract becomes the L1 allowlist story in the D7 stretch.

### 9.2 AuctionHouse
State per epoch: status (Open/Closed/Printed), per-tick per-side accumulator `Ciphertext side x tick → C_agg`, bid records `(bidder, side, tick, C_size)` (ciphertext only). Functions: `submitAsk(tick, C_size, fundsProofRef)`, `submitBid(tick, C_size)`, `closeEpoch()` (keeper, after window), `getAggregates(epoch)`. Funds proof for lenders *(✅ resolved: neither pattern shipped — `submitAsk` takes a `bytes fundsProofRef` placeholder (`"0x"` in practice) and funding magnitude is enforced at the auditor-attestation step, not at bid time; a trusted surface documented in METHODOLOGY.md)*. One bid per member per tick per epoch (bound accumulator gas).

### 9.3 MONIAOracle
`postPrint(epoch, r_star, DepthPoint[] depth, proof)` — verifies PoCD against AuctionHouse's stored `C_agg`s via the generated verifier, stores print, emits `RatePrinted(epoch, r_star, aggVolume)`. View: `latestRate()`, `rateAt(epoch)` — this is the settleable reference other contracts could consume (the "public artifact"). Rejects prints for epochs not Closed, double prints, stale proofs.

### 9.4 CollateralVault
`lockCollateral(loanId, C_collateral, solvencyProof)` — verifies Circuit 1 proof binding `(C_collateral, C_loanSize, h)`; escrows via eERC transfer from borrower to vault *(✅ resolved: contracts CANNOT be first-class eERC accounts — they can't hold a BJJ key or produce client-side proofs — so the implemented design is the vault-operator **EOA** custody pattern behind a two-step `lockCollateral → confirmLock` state machine; contract = authority, EOA = custody. METHODOLOGY.md §5, notes/07)*. `release(loanId)` (LoanBook-only), `seizeTo(loanId, lender)` (LoanBook-only).

### 9.5 LoanBook
`postMatches(epoch, Match[] matches)` (admin, after print): creates `Loan { lender, borrower, epoch, rateTick, C_size, deadlineBlock, status }`. `confirmFunding(loanId, transferRef)` — flips Pending→Active on verified lender→borrower eERC transfer (mechanism from teardown Q5). `repay(loanId, transferRef)` — verified borrower→lender transfer of `Enc(P+i)` `[note: interest math on encrypted values is done client-side by the borrower; the lender's client verifies received amount by decryption; the contract cannot check magnitude — document this honestly in METHODOLOGY.md]` → Active→Repaid → `vault.release`. `seize(loanId)` — anyone, `block.number > deadlineBlock` and Active → Defaulted → `vault.seizeTo(lender)`.

---

## 10. Circuits

### Circuit 1 — CollateralSolvency (`circuits/collateral_solvency/`)
Public: `C_collateral`, `C_loanSize`, `h` (=1.2 as integer basis points), owner pubkey. Private: owner privkey (or decryption randomness path — pick whichever the eERC ciphertext scheme makes cheaper; decide from teardown Q1). Constraints: correct decryption of both ciphertexts + `collateral * 10000 ≥ loanSize * 12000` (range-checked). Target: proving time < 10 s on K's laptop.

### Circuit 2 — DepthCurve PoCD (`circuits/depth_pocd/`)
Public: array of per-tick `C_agg` (fixed max ticks = 37 for the 1–10% band at 25 bps; pad unused), claimed per-tick sums, auditor pubkey. Private: auditor privkey. Constraint per tick: `Dec(C_agg_i) == claimed_i`. Start with the D2 single-sum version; generalize to the fixed-width array on D4. If constraint count explodes, batch into two proofs (bid side / ask side).

Build script requirement: one `make circuits` that compiles, runs setup, exports verifiers into `contracts/src/verifiers/`, and writes proving artifacts where services can load them.

---

## 11. Testing (definition of done per contract)

Unit tests per function including revert paths. **Invariant suite (Foundry `invariant_`)** — minimum set:

1. **Encrypted-collateral conservation:** vault's escrow set == exactly the set of Active loans' collateral; no reachable state with an Active loan and no lock.
2. **Epoch monotonicity:** status only moves Open→Closed→Printed; no bids accepted when not Open; no print without Closed.
3. **No double print / no double seize / no repay-after-seize.**
4. **Match integrity:** every Loan's rateTick == the printed `r*` of its epoch.
5. **Deadline safety:** `seize` never succeeds at `block.number ≤ deadlineBlock`.

E2E: a scripted full epoch on Anvil (mock verifiers behind an interface so e2e runs fast; real verifiers in a separate Fuji integration test). CI: `forge test` + circuit build on every push.

---

## 12. Phase 4 (D6–D7): services, dashboard, L1 stretch

**Keeper (`services/keeper/`):** cron `closeEpoch` at window end; block watcher scanning Active loans past deadline → `seize`. Idempotent, crash-safe (re-derives state from chain, no local DB required).

**Admin (`services/admin/`):** on `EpochClosed`: fetch `C_agg`s → decrypt (auditor key from env, never committed) → build cumulative supply/demand curves → `r*` = crossing tick (document tie-breaking: lowest crossing tick; pro-rata at margin) → generate PoCD → `postPrint` → compute match set → `postMatches`. **Never log plaintext sizes.** Expose only: rate, aggregate depth, epoch metadata.

**Agent bots (`services/agents/`):** 4–6 scripted members with distinct strategies (yield-target lender, desperate borrower, opportunistic borrower, noise trader) driving realistic rate movement across epochs. Every mention in UI/pitch labels them "simulated members" — the self-dealing disclosure is mandatory.

**Indexer + dashboard:** listen to `RatePrinted`, loan lifecycle events → REST → React dashboard with (a) M-ONIA ticker (big number, hourly/60s ticks, sparkline), (b) aggregate depth curve chart, (c) **explorer split-screen** — live Snowtrace/raw-ciphertext view side by side with the ticker. The closing demo line renders on this screen: *"The rate is public. The borrowing never was."*

**D7 stretch (only if D1–D6 complete on schedule):** `avalanche-cli` local/testnet L1 with transaction allowlist wired to MemberRegistry membership; redeploy the full stack via the existing deploy scripts' second profile; demo shows both deployments. If behind schedule: L1 stays one slide in the deck. Do not let this endanger the Fuji build — bonus points never outrank a finished core. *(✅ SHIPPED post-core: local sovereign L1 `thewindowl1` (43117) with the TxAllowList precompile synced from MemberRegistry by `services/allowlist` — `demo/run_l1.sh`, `notes/09`.)*

---

## 13. Day-by-day gate table

| Day | Deliverable | Gate to proceed |
|---|---|---|
| D1 (Jul 11) | Teardown notes w/ citations; register+wrap+transfer live on Fuji | All 7 teardown questions answered |
| D2 (Jul 12) | Toy accumulator + PoCD verified on Fuji | **THE GATE** — pass, or execute §8.4 pivot today |
| D3 | MemberRegistry + AuctionHouse + unit tests | Full epoch of encrypted bids accumulates on Anvil |
| D4 | Circuit 1 wired; Vault; Circuit 2 array version; invariants 1–2 | Solvency proof verifies on-chain |
| D5 | LoanBook lifecycle; invariants 3–5; e2e epoch on Anvil | borrow→repay and borrow→seize both green |
| D6 | Keeper + Admin live; full epoch end-to-end **on Fuji** | M-ONIA prints on Fuji unattended |
| D7 | Dashboard + indexer; L1 stretch decision 9 AM | Two-screen demo runs; freeze features |
| D8 | Pitch deck (half day) + demo video + rehearsal ×2 | Hook lands in first 20 s of video |
| D9 (Jul 18) | Buffer: proof-gen debugging, METHODOLOGY.md polish, submit | Submitted well before 3:29 AM IST Jul 19 |

---

## 14. Submission checklist (from the event brief)

- [ ] GitHub repo: this README, METHODOLOGY.md, ROADMAP.md, working code, `make demo` one-command scenario
- [ ] Pitch slides (mandatory): stigma narrative → live M-ONIA → architecture → honest-claims slide (§4 verbatim) → rotatable-administrator governance → metrics (epochs printed, loans cycled, proofs verified, proof-gen latency) → roadmap
- [ ] Demo video (supporting file): two-screen moment inside first 20 seconds; 6h loan compressed to 30 s; explorer ciphertext close
- [ ] Deployed addresses (Fuji; L1 if stretch landed) in README
- [ ] Prior-work disclosure: Mission Control is a pre-existing agent used as demo borrower; all contracts, circuits, services, and dashboard are new this sprint

---

## 15. Risk register

| Risk | Trigger | Response |
|---|---|---|
| Homomorphic accumulation blocked | D2 gate fail | §8.4 pivot, same day |
| PoCD circuit blowup on array version | D4 midday | Split bid/ask proofs; if still blocked, print with single-sum PoCD per side + attested per-tick breakdown. *(Outcome: the risk materialized as an EIP-170 verifier-size blowup, and the shipped fix was **10-tick two-sided chunking** — 4 proofs × 102 signals through ONE reusable verifier (17,892 B, deploys inline) — not the bid/ask split. See notes/07 "Chunked PoCD".)* |
| eERC transfer-to-contract escrow unsupported | Teardown Q5/§9.4 | Vault-controlled EOA holds escrow; contract holds authority, EOA holds funds; disclose in METHODOLOGY.md |
| Proof-gen too slow for live demo | D8 rehearsal | Pre-generate proofs for the scripted scenario; show one live proof + timing slide |
| Fuji flakiness during demo | any | Recorded video is the primary artifact; live demo is the encore |

## 16. Glossary

**M-ONIA** — Machine Overnight Index Average, the printed clearing rate. **eERC** — Avalanche's encrypted ERC-20 standard (ElGamal over BabyJubJub + Groth16, client-side proofs; converter mode wraps existing ERC-20s). **PoCD** — proof of correct decryption. **Epoch** — one auction round. **Tick** — 25 bp rate increment. **Haircut (h)** — collateral ratio, fixed 120%. **The Gate** — D2 feasibility checkpoint deciding homomorphic vs. commit-reveal architecture. **Administrator** — auditor-key holder; trusted, accountable, rotatable; publishes aggregates only.

---

*Built for the Avalanche Privacy Hackathon 2026. The rate is public. The borrowing never was.*