# M-ONIA Methodology

**M-ONIA** — the Machine Overnight Index Average — is the hourly uniform-price clearing rate of THE WINDOW, discovered from **encrypted** bid sizes and printed on-chain with a **proof of correct decryption (PoCD)**. This document is the honest, complete description of what is proven, what is trusted, and exactly what leaks. It follows the SOFR model: confidential transaction inputs, an accountable administrator, a public benchmark.

> The rate is public. The borrowing never was.

---

## 1. The auction

- **Members** submit orders during an epoch: lenders submit **asks** `(rateTick PUBLIC, Enc(size))`, borrowers submit **bids** `(rateTick PUBLIC, Enc(size))`. Rate ticks are public (a rate leaks almost nothing); **sizes are eERC ElGamal ciphertexts** (BabyJubJub, encrypted to the auditor key).
- **Tick grid:** 37 ticks, index `i` → `(100 + 25·i)` bps = **1.00%–10.00% at 25 bps**.
- **Accumulation:** for each `(epoch, side, tick)` the `AuctionHouse` contract homomorphically accumulates `Σ Enc(size)` by BabyJubJub point addition on the ciphertexts (`Enc(a) ⊕ Enc(b) = Enc(a+b)`). No plaintext size ever touches the chain.
- **Uniform-price clearing.** Cumulative supply at rate `r` = Σ asks with tick ≤ r; cumulative demand at `r` = Σ bids with tick ≥ r. The clearing rate **r\*** is the lowest tick where supply ≥ demand (both positive). All fills clear at r\*. Matched volume = `min(cumulativeSupply(r*), cumulativeDemand(r*))`. **Tie-break:** the lowest crossing tick. **Pro-rata:** at the marginal tick, fills are allocated pro-rata to size (computed by the administrator; disclosed). If the curves never cross, the epoch prints **"no trade"** and M-ONIA carries the last print (flagged stale).

## 2. Proof of correct decryption (PoCD)

The clearing rate is only meaningful if the published depth curve is the **true** decryption of the on-chain ciphertext accumulators — otherwise the administrator could reshape it. `MONIAOracle.postPrint` therefore:

1. Rebuilds the verifier's public-input vector **from the on-chain accumulators** (each tick's `c1,c2` read from `AuctionHouse`, per side) plus the claimed per-tick sums plus the auditor public key.
2. Verifies a Groth16 **PoCD** proving, for every tick and side: `Dec(auditorPriv, C_agg[side][tick]) == claimedSum[side][tick]`, and that `auditorPub == auditorPriv·G`.
3. Computes r\* and matched volume **on-chain** from the proven depth, and rejects any print whose claimed r\* ≠ the on-chain crossing.

So the **shape** of the curve is proven, not merely the totals. The circuit reuses the audited eERC BabyJubJub/ElGamal templates (`CheckPublicKey`, `CheckValue`, `ElGamalDecrypt`). Discrete logs are never computed in-circuit — the circuit checks the forward relation `claimed·G == c2 − priv·c1`; the administrator recovers the scalar off-chain by baby-step-giant-step over the bounded aggregate range.

## 3. Collateral solvency (zero-knowledge)

Before an encrypted loan is funded, the borrower posts a Groth16 proof (`CollateralSolvency`, Circuit 1) that `Dec(collateral)·10000 ≥ Dec(loanSize)·h` with fixed haircut **h = 120%**, revealing neither amount. Cash-secured only: collateral is encrypted wrapped-USDC; a missed deadline block is the sole default condition, and seizure is deterministic.

---

## 4. Privacy model — the honest leak budget

**Hidden from the public:** bid sizes, loan sizes, collateral amounts, repayment amounts, every account's encrypted balance, and any individual's borrowing *history* (the sequence — arguably the most valuable secret).

**Visible to the public:** the rate ticks bid at (not by whom, at what size), **member addresses** (eERC hides amounts, **not** sender/receiver addresses — we say this before a judge does), epoch timing, M-ONIA prints, aggregate depth per tick, loan *count* and lifecycle events (not sizes), seizure events (not amounts).

**Visible to the Administrator:** everything, by decryption under the auditor key. Mitigations: the role is (a) contractually bound to publish only aggregates, (b) auditable — every print carries a PoCD, (c) **rotatable** via eERC auditor key rotation. This is a *trusted, accountable* role, analogous to a benchmark administrator (cf. ICE Benchmark Administration). **We never claim "undecryptable," "trustless," or "nobody can see the bids."** The administrator CAN decrypt individual bids; that is the documented, SOFR-style trust model, stated proudly.

**Known non-goals:** receipt-freeness (a member can voluntarily decrypt to prove their own bid), timing-analysis resistance (bid submission timing is public), and network-level privacy.

---

## 5. Trusted / accountable surfaces (stated honestly)

- **Administrator (auditor key holder).** Decrypts per-tick aggregates and individual amounts; publishes only aggregates + the rate; every print carries a PoCD; the role is rotatable. The only place plaintext exists is inside the admin service (the 5→6 boundary); it never writes plaintext sizes to logs, DB, or API.
- **Funding / repayment magnitude is auditor-attested, not contract-enforced.** eERC transfer events carry no plaintext amount (only an auditor-decryptable Poseidon ciphertext). The administrator watches transfers, decrypts the amount with the auditor key, checks parties + amount, and then calls `confirmFunding` / `repay`. The contract enforces **lifecycle finality** (no repay-after-seize, no double-fund, deadline safety), not transfer magnitude.
- **Collateral custody uses a registered vault-operator EOA.** A Solidity contract cannot hold a BabyJubJub key or generate client-side proofs, so it cannot be a first-class eERC account. Custody of encrypted collateral sits in a **registered vault-operator EOA**; the `CollateralVault` contract holds the *authority* and records, and movement is event-driven (the operator executes the eERC transfer, then confirms on-chain). Authority is on-chain; custody is in the EOA.
- **Simulated members.** For the demo, all bidders are scripted bots operated by the team, disclosed everywhere as **"simulated members."** They demonstrate member behavior, not organic price discovery.

---

## 6. On-chain guarantees (what the math actually enforces)

1. The public only ever learns aggregates + the rate (individual sizes are ciphertext).
2. The PoCD proves the published depth curve is the true decryption of the on-chain ciphertext accumulators.
3. Collateral sufficiency is proven in zero knowledge (120% haircut).
4. Settlement finality is contract-enforced: epoch monotonicity (Open→Closed→Printed), no double print, every loan clears at its epoch's printed r\*, no repay-after-seize, and `seize` is impossible at or before the deadline block.
