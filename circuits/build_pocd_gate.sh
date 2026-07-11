#!/usr/bin/env bash
# D2 GATE: build + prove the DepthCurve PoCD (single-sum) end to end.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"
B="$ROOT/build"
mkdir -p "$B"
export PATH="$HOME/.cargo/bin:$PATH"

echo "== 1. compile circuit =="
circom depth_pocd/depth_pocd.circom --r1cs --wasm --sym -o "$B" \
  -l "$ROOT/../contracts/lib/EncryptedERC/circom"

echo "== 2. powers of tau (2^15) =="
if [ ! -f "$B/pot15_final.ptau" ]; then
  snarkjs powersoftau new bn128 15 "$B/pot15_0.ptau" -v
  snarkjs powersoftau contribute "$B/pot15_0.ptau" "$B/pot15_1.ptau" --name="window-gate" -v -e="the window gate entropy 1"
  snarkjs powersoftau prepare phase2 "$B/pot15_1.ptau" "$B/pot15_final.ptau" -v
fi

echo "== 3. groth16 setup + contribute =="
snarkjs groth16 setup "$B/depth_pocd.r1cs" "$B/pot15_final.ptau" "$B/depth_pocd_0.zkey"
snarkjs zkey contribute "$B/depth_pocd_0.zkey" "$B/depth_pocd_final.zkey" --name="window-gate-2" -v -e="the window gate entropy 2"
snarkjs zkey export verificationkey "$B/depth_pocd_final.zkey" "$B/depth_pocd_vkey.json"

echo "== 4. export solidity verifier =="
snarkjs zkey export solidityverifier "$B/depth_pocd_final.zkey" "$ROOT/../contracts/src/verifiers/DepthPoCDVerifier.sol"

echo "== 5. witness + proof =="
node "$B/depth_pocd_js/generate_witness.js" "$B/depth_pocd_js/depth_pocd.wasm" "$B/pocd_input.json" "$B/witness.wtns"
snarkjs groth16 prove "$B/depth_pocd_final.zkey" "$B/witness.wtns" "$B/proof.json" "$B/public.json"

echo "== 6. off-chain verify =="
snarkjs groth16 verify "$B/depth_pocd_vkey.json" "$B/public.json" "$B/proof.json"

echo "== 7. solidity calldata =="
snarkjs zkey export soliditycalldata "$B/public.json" "$B/proof.json" > "$B/calldata.txt"
echo "calldata written to build/calldata.txt"
