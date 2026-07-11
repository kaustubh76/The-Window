#!/usr/bin/env bash
# Phase B: build + prove the 37-tick DepthCurve array PoCD end to end (2^20 ptau).
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"
B="$ROOT/build"
export PATH="$HOME/.cargo/bin:$PATH"
PTAU="$B/powersOfTau28_hez_final_20.ptau"

[ -f "$PTAU" ] || { echo "ERROR: $PTAU missing (download it first)"; exit 1; }

echo "== 1. compile =="
circom depth_pocd/depth_pocd_array.circom --r1cs --wasm --sym -o "$B" \
  -l "$ROOT/../contracts/lib/EncryptedERC/circom"

echo "== 2. groth16 setup + contribute (this is heavy: ~540k constraints) =="
snarkjs groth16 setup "$B/depth_pocd_array.r1cs" "$PTAU" "$B/depth_array_0.zkey"
snarkjs zkey contribute "$B/depth_array_0.zkey" "$B/depth_array_final.zkey" --name="window-array" -v -e="window array entropy"
snarkjs zkey export verificationkey "$B/depth_array_final.zkey" "$B/depth_array_vkey.json"

echo "== 3. export verifier =="
snarkjs zkey export solidityverifier "$B/depth_array_final.zkey" "$ROOT/../contracts/src/verifiers/DepthPoCDArrayVerifier.sol"
# unique contract name to avoid collision with the single-sum verifier
perl -pi -e 's/contract Groth16Verifier/contract DepthPoCDArrayVerifier/' "$ROOT/../contracts/src/verifiers/DepthPoCDArrayVerifier.sol"

echo "== 4. witness + proof =="
node "$B/depth_pocd_array_js/generate_witness.js" "$B/depth_pocd_array_js/depth_pocd_array.wasm" "$B/pocd_array_input.json" "$B/depth_array_witness.wtns"
snarkjs groth16 prove "$B/depth_array_final.zkey" "$B/depth_array_witness.wtns" "$B/depth_array_proof.json" "$B/depth_array_publicsig.json"

echo "== 5. off-chain verify =="
snarkjs groth16 verify "$B/depth_array_vkey.json" "$B/depth_array_publicsig.json" "$B/depth_array_proof.json"

echo "== 6. calldata =="
snarkjs zkey export soliditycalldata "$B/depth_array_publicsig.json" "$B/depth_array_proof.json" > "$B/depth_array_calldata.txt"
echo "done"
