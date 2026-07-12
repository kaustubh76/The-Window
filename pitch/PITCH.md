---
marp: true
theme: gaia
class: invert
paginate: true
style: |
  section { font-size: 26px; }
  h1 { color: #f0c674; }
  h2 { color: #f0c674; }
  code { color: #7fd7e8; }
  table { font-size: 21px; }
---

<!-- _class: lead invert -->

# THE WINDOW

## The rate is public. The borrowing never was.

**A private machine money market on Avalanche (eERC)**
Hourly encrypted auctions → **M-ONIA**, the first benchmark rate for the agent economy — printed on-chain with a zero-knowledge proof of correct decryption.

**LIVE on Fuji** · https://the-window-five.vercel.app
Avalanche Team1 India Speedrun — *Privacy on Avalanche* · July 2026

---

## The problem: observable borrowing kills lending markets

- The best-documented pathology in monetary economics: **discount-window stigma**. In 2008, banks paid *above* the Fed's window rate rather than be **seen** borrowing from it. Dodd-Frank mandates a **two-year disclosure lag** for exactly this reason.
- Port that to a public chain: an AI agent borrowing overnight working capital broadcasts **"I am short"** to every counterparty, in real time.
  - Suppliers reprice it. Lenders quote wider. Competitors front-run.
- Rational agents therefore never borrow — they **overfund every wallet** (dead capital) — and the machine money market **fails to form**.

> On a transparent chain this product is not worse. It is **impossible**.

---

## The insight: invert the transparency (the SOFR model)

**Confidential inputs → accountable administrator → public benchmark.**

That is exactly how SOFR works today: banks report transactions confidentially, an accountable administrator aggregates, and only the **benchmark** is public.

THE WINDOW puts that on-chain:

- Individual bids, loan sizes, collateral, repayments — **ciphertext, end-to-end** (eERC ElGamal).
- The aggregate clearing rate — **M-ONIA** — is the public good.
- The administrator **cannot lie**: every print carries a Groth16 **proof of correct decryption** against on-chain ciphertext accumulators, and the contract **recomputes the clearing rate on-chain** from the proven curve.

Privacy is not a feature here. It is the **precondition for price discovery**.

---

## What we built (all of it live on Fuji)

Every epoch, members (machine treasuries) bid at **public rate ticks** with **encrypted sizes**:

1. `AuctionHouse` **homomorphically accumulates** encrypted sizes per tick — on-chain EC point addition (~13k gas/add), no decryption anywhere.
2. At close, the Benchmark Administrator (holder of the eERC **auditor key** — the *only* plaintext surface) decrypts the **aggregates only**, computes r*, and posts it with a **chunked 4-proof PoCD** binding the published depth curve to the on-chain accumulators.
3. `MONIAOracle` verifies all 4 proofs **and independently recomputes r\* on-chain** → a valid proof with a wrong rate **reverts**.
4. Matched loans run a fully collateralized lifecycle: **ZK solvency proof** (coll ≥ 120% loan, amounts encrypted) → two-step vault escrow → attested funding → repay, or **permissionless seize** past deadline.

---

## Live on Fuji — real, autonomous, verifiable **right now**

| | |
|---|---|
| Autonomous epochs printed | **55+** (advancing every 120 s) |
| M-ONIA trade prints | **8** — latest r* = **350 bps** |
| Loans cycled end-to-end | **12** — 3 repaid · **7 defaulted → seized on-chain** · 2 pending |
| Gas per print | **~4.46M** = 4 × real Groth16 verify + storage — *even no-trade epochs prove* |
| Deployment provenance | 20 txs, blocks **56,937,681–716**, all in-repo (`contracts/broadcast/`) |

**App:** the-window-five.vercel.app · **AuctionHouse:** `0xd001…a71e` · **MONIAOracle:** `0xD197…CEc2` — every event in the UI links to Snowtrace.

*Nothing is mocked: the hosted dashboard reads a live indexer of Fuji events, and every write generates a real server-side proof and a real Fuji transaction.*

---

## The ZK war story: fitting a 37-tick proof under EIP-170

The naive design — one PoCD over the full 37-tick curve (372 public signals) — compiles to a **62,708-byte** verifier. EIP-170 caps contracts at 24,576 bytes: **undeployable on any real network.**

**Our fix: 10-tick two-sided chunking.**

- ONE circuit `DepthPoCDArray(10)`, **4 chunk proofs × 102 public signals** cover ticks `[0..9]…[30..36]` (+3 identity-padded virtual ticks).
- Verifier: **17,892 bytes — deploys inline**, no hacks. This is what made Fuji possible.
- Each proof embeds **its own slice of the on-chain accumulators** — swapping two individually-valid chunk proofs **fails on-chain** (regression-tested).
- `MONIAOracle._buildChunkSignals` reconstructs the exact 102-signal layout from storage: the proof is bound to **chain state**, not admin-supplied data.

Plus a second circuit: **CollateralSolvency** — proves `Dec(coll)·10000 ≥ Dec(loan)·12000` over encrypted amounts, bound to the borrower's key. 11 public signals, verified on-chain at lock time.

---

## Honest privacy claims — the leak budget

We **never** claim "trustless", "undecryptable", or "nobody can see the bids". (CI greps the entire dashboard source for those phrases and **fails the build** if they appear.)

| | |
|---|---|
| **Hidden** | bid sizes, loan sizes, collateral, repayments, balances, any individual's borrowing history |
| **Visible** | member addresses, rate ticks chosen, epoch timing, lifecycle events, aggregate depth, prints |
| **Administrator** | CAN decrypt everything under the auditor key — **accountable, rotatable** (eERC `setAuditorPublicKey`), and forced honest by PoCD + on-chain r* recompute |

Two disclosed trusted surfaces (eERC's `PrivateTransfer` carries no plaintext amount, so funding magnitude is auditor-attested; vault custody is an operator EOA because contracts can't hold BJJ keys) — documented in `METHODOLOGY.md`, stated in the UI. **This is the SOFR governance model, and we pitch it as such.**

---

## Usage of Avalanche technologies

- **eERC (Encrypted ERC), converter mode** — deep integration, not SDK-surface: we tore down the protocol (`spike/NOTES.md`), regenerate Solidity verifiers from the exact zkeys, drive registration/deposit/withdraw with our own server-side prover (`packages/eerc-node`: snarkjs + the protocol's own crypto libraries), and use the **auditor-key mechanism** as the benchmark administrator role.
- **Homomorphic accumulation of eERC ciphertexts by an external contract** — validated on-chain before building (the D2 gate: ~13k gas per encrypted add).
- **Avalanche Fuji C-Chain** — full stack deployed + running autonomously; every UI event deep-links to **Snowtrace**.
- **Permissioned Avalanche L1** — [see roadmap slide: membership-gated L1 where `MemberRegistry` drives the transaction allowlist].
- Two custom **circom/Groth16** circuits with regenerated on-chain verifiers.

---

## Track fit

**Private DeFi — Sealed-Order Book.** The auction IS a sealed order book: public ticks, encrypted sizes, uniform-price clearing, on-chain proof the book cleared honestly.

**Compliance-Friendly Privacy — Auditor-Ready.** One rotatable auditor key can decrypt everything when compliance demands it; its published outputs are cryptographically forced honest. Confidential to the market, transparent to the regulator.

**Value proposition:** the agent economy needs a money market; a money market needs privacy; privacy needs accountability. THE WINDOW is all three — and prints the benchmark rate (M-ONIA) the whole agent economy can reference, the way markets reference SOFR.

---

## Engineering rigor

| | |
|---|---|
| Contracts | 6 core + verifier seam · Foundry · **49 tests** incl. **5 fuzzed invariants** (collateral conservation, deadline safety, no-double-terminal, match rate, epoch monotonicity) |
| ZK gates | on-chain regression tests: tampered ciphertext fails, tampered haircut fails, **cross-chunk proof swap fails**, wrong claimed r* reverts |
| Dashboard | React/Vite · 30 tests incl. the **honest-claims CI lint** · live/mock adapter with **no silent fallback** — if services are down you see a banner, never fake data |
| Reproducibility | `make demo` — **zero secrets needed**: fresh clone → local Anvil → full epoch with real proofs. Judges can verify everything themselves |
| Ops | hosted: Vercel (frontend) + Render (indexer + write API from a Docker image); drivers autonomous; indexer is stateless — rebuilds everything from chain events |

---

## Roadmap

- **Permissioned L1** — `avalanche-cli` L1 where the **TxAllowList precompile is synced from MemberRegistry**: non-members cannot transact at the chain level. *(Status: see live demo / repo — implemented during the Speedrun window.)*
- **Threshold auditor** — replace the single auditor key with MPC/threshold decryption so no single party holds plaintext power.
- **Term tenors + tradeable positions** — beyond overnight; secondary market for loan positions.
- **Production benchmark ops** — auditor key rotation ceremony, durable indexer, HA services.
- **A contract-enforced funding hook** — if eERC gains a verifiable transfer-amount primitive, attested funding becomes trustless.

---

<!-- _class: lead invert -->

## THE WINDOW

**The rate is public. The borrowing never was.**

| | |
|---|---|
| Live app | **https://the-window-five.vercel.app** |
| Repo | **https://github.com/kaustubh76/The-Window** |
| Chain | Avalanche Fuji `43113` — addresses in `contracts/deployments/43113.json` |
| Docs | `Readme.md` · `METHODOLOGY.md` · `notes/` (full implementation docs) |

Built solo, in-window (July 10–12), for the Avalanche Team1 India Speedrun.

*Machines will need to borrow. They will refuse to be watched doing it.*
