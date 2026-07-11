#!/usr/bin/env bash
# D4: build + prove the CollateralSolvency (Circuit 1) end to end.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"
B="$ROOT/build"
export PATH="$HOME/.cargo/bin:$PATH"

echo "== 1. compile =="
circom collateral_solvency/collateral_solvency.circom --r1cs --wasm --sym -o "$B" \
  -l "$ROOT/../contracts/lib/EncryptedERC/circom"

echo "== 2. setup (reuse pot15_final.ptau) =="
snarkjs groth16 setup "$B/collateral_solvency.r1cs" "$B/pot15_final.ptau" "$B/solvency_0.zkey"
snarkjs zkey contribute "$B/solvency_0.zkey" "$B/solvency_final.zkey" --name="window-solvency" -v -e="window solvency entropy"
snarkjs zkey export verificationkey "$B/solvency_final.zkey" "$B/solvency_vkey.json"

echo "== 3. export verifier =="
snarkjs zkey export solidityverifier "$B/solvency_final.zkey" "$ROOT/../contracts/src/verifiers/CollateralSolvencyVerifier.sol"

echo "== 4. witness + proof =="
node "$B/collateral_solvency_js/generate_witness.js" "$B/collateral_solvency_js/collateral_solvency.wasm" "$B/solvency_input.json" "$B/solvency_witness.wtns"
snarkjs groth16 prove "$B/solvency_final.zkey" "$B/solvency_witness.wtns" "$B/solvency_proof.json" "$B/solvency_public.json"

echo "== 5. off-chain verify =="
snarkjs groth16 verify "$B/solvency_vkey.json" "$B/solvency_public.json" "$B/solvency_proof.json"

echo "== 6. calldata =="
snarkjs zkey export soliditycalldata "$B/solvency_public.json" "$B/solvency_proof.json" > "$B/solvency_calldata.txt"
echo "done"
