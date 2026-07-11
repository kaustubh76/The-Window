#!/usr/bin/env bash
# Deploy the full WINDOW stack to Avalanche Fuji (43113). No code-size hacks needed:
# the chunked 102-signal DepthPoCDArrayVerifier (~18KB) fits EIP-170 and deploys inline.
# Requires in env / root .env: ADMIN_PK, KEEPER_PK, VAULT_OPERATOR_PK (real funded keys),
# AUDITOR_BJJ_PUB_X/Y. Writes contracts/deployments/43113.json (via block.chainid).
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# load root .env for keys if not already exported
set -a; [ -f "$ROOT/.env" ] && source "$ROOT/.env"; set +a

RPC="${RPC_FUJI:-https://api.avax-test.network/ext/bc/C/rpc}"
: "${ADMIN_PK:?ADMIN_PK required (funded Fuji key)}"
: "${KEEPER_PK:?KEEPER_PK required}"
: "${VAULT_OPERATOR_PK:?VAULT_OPERATOR_PK required}"
: "${AUDITOR_BJJ_PUB_X:?AUDITOR_BJJ_PUB_X required}"
: "${AUDITOR_BJJ_PUB_Y:?AUDITOR_BJJ_PUB_Y required}"

KEEPER_ADDR="$(cast wallet address --private-key "$KEEPER_PK")"
VAULT_OPERATOR_ADDR="$(cast wallet address --private-key "$VAULT_OPERATOR_PK")"
ADMIN_ADDR="$(cast wallet address --private-key "$ADMIN_PK")"
echo "deployer/admin: $ADMIN_ADDR  keeper: $KEEPER_ADDR  operator: $VAULT_OPERATOR_ADDR"
echo "admin balance: $(cast balance "$ADMIN_ADDR" --rpc-url "$RPC" -e) AVAX"

cd "$ROOT/contracts"
forge build -q

echo "== deploying + wiring WINDOW stack to Fuji =="
SNOWTRACE_API_KEY="${SNOWTRACE_API_KEY:-dummy}" ADMIN_PK="$ADMIN_PK" USE_REAL_VERIFIERS=1 \
  EPOCH_LEN="${EPOCH_LEN:-120}" TENOR_BLOCKS="${TENOR_BLOCKS:-60}" \
  AUDITOR_PUB_X="$AUDITOR_BJJ_PUB_X" AUDITOR_PUB_Y="$AUDITOR_BJJ_PUB_Y" \
  KEEPER_ADDR="$KEEPER_ADDR" VAULT_OPERATOR_ADDR="$VAULT_OPERATOR_ADDR" \
  forge script script/DeployAll.s.sol --rpc-url "$RPC" --broadcast --slow 2>&1 \
  | grep -iE 'AuctionHouse|MONIAOracle|real verifiers|SUCCESSFUL|Error|error' || true

echo "== deployments/43113.json =="
cat deployments/43113.json
