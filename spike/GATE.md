# D2 — THE GATE: **PASS** ✅

**Decision (per README §8.2):** Build the full homomorphic + PoCD architecture. **No pivot** to commit-reveal (§8.4).

Date: D0/D1 fast-tracked (env → teardown → gate in one session). Verified locally in the EVM (Foundry); re-run on Fuji as the explicit go-on-chain step once EOAs are faucet-funded.

## What was proven

### Part (a) — external contracts can homomorphically accumulate eERC ciphertexts on-chain
`contracts/src/spike/ToyAccumulator.sol` + `contracts/test/ToyAccumulator.t.sol`.
- `Enc(m1) ⊕ Enc(m2)` accumulated via `BabyJubJub._add` on `c1`/`c2` decrypts to `(m1+m2)·G` — verified for 2 and for 10 accumulated ciphertexts.
- **Per-add cost ≈ 12,981 gas** (2 point-adds + SSTORE) — far under the ~500k budget.
- This is exactly AuctionHouse's per-tick `Σ Enc(size)` accumulator.

### Part (b) — a PoCD over the on-chain sum verifies on-chain
`circuits/depth_pocd/depth_pocd.circom` (reuses eERC's audited `CheckPublicKey` + `CheckValue` templates) + `contracts/src/verifiers/DepthPoCDVerifier.sol` (generated) + `contracts/test/DepthPoCDGate.t.sol`.
- Circuit: **~12k non-linear constraints** (single-sum version). Groth16, ptau 2^15.
- Proves `(1) auditorPub == auditorPriv·G` and `(2) Dec(auditorPriv, Csum) == claimedSum`.
- Off-chain: `snarkjs groth16 verify` → **OK!**
- On-chain (EVM): valid proof **verifies at ~266k gas**; tampered claimed sum (350→351) **fails**; tampered proof element **fails**.

## Reproduce
```
cd packages/eerc-node && npm i && node src/gen_pocd_input.mjs   # build witness inputs (+ BSGS self-check)
bash circuits/build_pocd_gate.sh                                # compile → ptau → setup → verifier.sol → prove → verify
cd contracts && forge test --match-contract "ToyAccumulatorTest|DepthPoCDGateTest" -vv
```

## Implications for the full build
- **AuctionHouse** stores an `EGCT` accumulator per (epoch, side, tick); `submitBid/Ask` calls `BabyJubJub._add`. Cheap.
- **MONIAOracle.postPrint** feeds the on-chain accumulator's `(c1,c2)` per tick + claimed sums + auditor pubkey as the verifier's public signals — the proof is bound to on-chain state, not admin-supplied numbers.
- **D4 array circuit**: replicate `CheckValue` across 37 ticks (share `CheckPublicKey` once). ~12k × 37 ≈ 440k constraints for one side → split bid/ask into two proofs (README §15 fallback ladder). ptau 2^19–2^20.
- **Admin service** recovers plaintext sums via `packages/eerc-node/elgamal.mjs` `decryptToPoint` + `bsgs` (validated here end-to-end).
