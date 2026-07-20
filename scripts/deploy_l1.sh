#!/usr/bin/env bash
# Deploy the full WINDOW stack to the permissioned Avalanche L1 ("thewindowl1",
# chainId 43117, created from l1/genesis.json — Subnet-EVM with the TxAllowList
# precompile). Live-only: real role keys + auditor come from the root .env (no Anvil),
# matching genesis's real TxAllowList admin/enabled roles. Writes deployments/43117.json.
#
# Prereq: the L1 is running —
#   avalanche blockchain create thewindowl1 --evm --genesis l1/genesis.json \
#     --proof-of-authority --validator-manager-owner 0x6358c6B980fad929247b932207893b4dB2F7cd82 \
#     --proxy-contract-owner   0x6358c6B980fad929247b932207893b4dB2F7cd82 --evm-token WIN --latest --icm=false
#   avalanche blockchain deploy thewindowl1 --local   # (or --fuji -k windowdeployer for the Fuji-anchored L1)
# RPC_L1 = the "RPC Endpoint" from `avalanche blockchain describe thewindowl1`.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

: "${RPC_L1:?RPC_L1 required — see: avalanche blockchain describe thewindowl1}"

# Live-only: real role keys + auditor from the root .env (Fuji throwaways) — no Anvil.
[ -f "$ROOT/.env" ] || { echo "ERROR: root .env missing — the live-only L1 needs real keys"; exit 1; }
set -a; source "$ROOT/.env"; set +a
for v in ADMIN_PK KEEPER_PK VAULT_OPERATOR_PK AUDITOR_BJJ_PUB_X AUDITOR_BJJ_PUB_Y; do
  [ -n "${!v:-}" ] || { echo "ERROR: $v missing in .env — the live-only L1 requires real keys"; exit 1; }
done
# preflight: every driver key's address must match l1/genesis.json (admin/enabled/alloc) — else
# the deploy or a later onlyAdmin/allowlist tx would revert. Fails loud on any mismatch.
node "$ROOT/scripts/preflight_l1.mjs"
OPERATOR_PK="$VAULT_OPERATOR_PK"
AUDITOR_PUB_X="$AUDITOR_BJJ_PUB_X"
AUDITOR_PUB_Y="$AUDITOR_BJJ_PUB_Y"

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
