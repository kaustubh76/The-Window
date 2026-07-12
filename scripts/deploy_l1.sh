#!/usr/bin/env bash
# Deploy the full WINDOW stack to the local permissioned Avalanche L1 ("thewindowl1",
# chainId 43117, created from l1/genesis.json — Subnet-EVM with the TxAllowList
# precompile). Same zero-secret posture as the local demos: Anvil default keys +
# the fixed demo auditor keypair. Writes contracts/deployments/43117.json.
#
# Prereq: the L1 is running —
#   avalanche blockchain create thewindowl1 --evm --genesis l1/genesis.json \
#     --proof-of-authority --validator-manager-owner <anvil#0> \
#     --proxy-contract-owner <anvil#0> --evm-token WIN --latest --icm=false
#   avalanche blockchain deploy thewindowl1 --local
# RPC_L1 = the "RPC Endpoint" from `avalanche blockchain describe thewindowl1`.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

: "${RPC_L1:?RPC_L1 required — see: avalanche blockchain describe thewindowl1}"

# Anvil default keys (public test keys, same as run_demo/run_autonomous)
export ADMIN_PK="${ADMIN_PK:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"   # #0
KEEPER_PK="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"                      # #1
OPERATOR_PK="0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"                    # #2
# fixed demo auditor keypair (services/lib/actors.mjs defaults)
AUDITOR_PUB_X="${AUDITOR_BJJ_PUB_X:-15126131017275559229883198140197230023892265818363501039953620538039205717764}"
AUDITOR_PUB_Y="${AUDITOR_BJJ_PUB_Y:-7504911034826791718448377250227968384413910115391011404817860837847273794444}"

KEEPER_ADDR="$(cast wallet address --private-key "$KEEPER_PK")"
VAULT_OPERATOR_ADDR="$(cast wallet address --private-key "$OPERATOR_PK")"
ADMIN_ADDR="$(cast wallet address --private-key "$ADMIN_PK")"
echo "L1 deployer/admin: $ADMIN_ADDR  keeper: $KEEPER_ADDR  operator: $VAULT_OPERATOR_ADDR"
echo "admin balance: $(cast balance "$ADMIN_ADDR" --rpc-url "$RPC_L1" -e) WIN"

cd "$ROOT/contracts"
forge build -q

echo "== deploying + wiring WINDOW stack to thewindowl1 (43117) =="
ADMIN_PK="$ADMIN_PK" USE_REAL_VERIFIERS=1 \
  EPOCH_LEN="${EPOCH_LEN:-60}" TENOR_BLOCKS="${TENOR_BLOCKS:-20}" \
  AUDITOR_PUB_X="$AUDITOR_PUB_X" AUDITOR_PUB_Y="$AUDITOR_PUB_Y" \
  KEEPER_ADDR="$KEEPER_ADDR" VAULT_OPERATOR_ADDR="$VAULT_OPERATOR_ADDR" \
  forge script script/DeployAll.s.sol --rpc-url "$RPC_L1" --broadcast --slow 2>&1 \
  | grep -iE 'AuctionHouse|MONIAOracle|real verifiers|SUCCESSFUL|Error|error' || true

echo "== deployments/43117.json =="
cat deployments/43117.json
