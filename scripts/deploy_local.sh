#!/usr/bin/env bash
# Deploy the full WINDOW stack to a local Anvil (vanilla — no code-size hacks needed:
# the chunked 102-signal DepthPoCDArrayVerifier is ~18KB, under EIP-170).
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC="${RPC_LOCAL:-http://127.0.0.1:8545}"
KEY="${ADMIN_PK:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"

# Caller (run_demo.sh) exports the demo env; do NOT source .env here (it would
# override the demo auditor key / tenor). Standalone use relies on env + defaults.

# Derive actor addresses from PKs (fallback to anvil #1/#2 if unset)
KEEPER_ADDR="${KEEPER_ADDR:-$(cast wallet address --private-key "${KEEPER_PK:-0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d}")}"
VAULT_OPERATOR_ADDR="${VAULT_OPERATOR_ADDR:-$(cast wallet address --private-key "${VAULT_OPERATOR_PK:-0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a}")}"

cd "$ROOT/contracts"
forge build -q

echo "== deploying + wiring WINDOW stack =="
SNOWTRACE_API_KEY=dummy ADMIN_PK="$KEY" USE_REAL_VERIFIERS=1 \
  EPOCH_LEN="${EPOCH_LEN:-60}" TENOR_BLOCKS="${TENOR_BLOCKS:-150}" \
  AUDITOR_PUB_X="${AUDITOR_BJJ_PUB_X:-0}" AUDITOR_PUB_Y="${AUDITOR_BJJ_PUB_Y:-0}" \
  KEEPER_ADDR="$KEEPER_ADDR" VAULT_OPERATOR_ADDR="$VAULT_OPERATOR_ADDR" \
  forge script script/DeployAll.s.sol --rpc-url "$RPC" --broadcast 2>&1 \
  | grep -iE 'AuctionHouse|MONIAOracle|real verifiers|SUCCESSFUL|Error' || true

echo "== deployments/$(cast chain-id --rpc-url "$RPC").json =="
cat "deployments/$(cast chain-id --rpc-url "$RPC").json"
