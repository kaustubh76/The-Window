#!/usr/bin/env bash
# FUJI story: run the full autonomous service stack (indexer + control + keeper +
# agents + operator + admin) against Avalanche Fuji — NO anvil, NO scenario script,
# real chain, real chunked PoCD. The services autonomously open/close epochs, bid,
# print M-ONIA, and cycle loans (repay + default->seize).
#
# Prereqs (one-time):
#   1. scripts/fund_fuji.mjs      — gas-fund all actor EOAs from WALLET_PRIVATE_KEY
#   2. scripts/deploy_fuji.sh     — deploy the stack (writes deployments/43113.json)
#   3. CHAIN_ID=43113 node packages/eerc-node/src/register_all.mjs
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Real keys + auditor come from the root .env (Fuji throwaways). Do NOT export
# anvil keys here — that's the difference from run_autonomous.sh.
set -a; source "$ROOT/.env"; set +a

export RPC_LOCAL="${RPC_FUJI:-https://api.avax-test.network/ext/bc/C/rpc}"  # the var services read
export CHAIN_ID=43113 INDEXER_PORT="${INDEXER_PORT:-8787}" CONTROL_PORT="${CONTROL_PORT:-8899}" PROFILE=DEMO
# Fuji timing: epochs must outlast chunked-PoCD proving (~40s) + real confirmations.
export EPOCH_LEN="${EPOCH_LEN:-120}" TENOR_BLOCKS="${TENOR_BLOCKS:-60}" KEEPER_STALL_S="${KEEPER_STALL_S:-300}"
export ADMIN_POLL_MS=5000 KEEPER_POLL_MS=5000 AGENTS_POLL_MS=5000 OPERATOR_POLL_MS=5000

[ -f "$ROOT/contracts/deployments/43113.json" ] || { echo "ERROR: deployments/43113.json missing — run scripts/deploy_fuji.sh first"; exit 1; }
for v in ADMIN_PK KEEPER_PK VAULT_OPERATOR_PK LENDER1_PK LENDER2_PK BORROWER_PK AGENT4_PK AGENT5_PK AUDITOR_BJJ_PRIV; do
  [ -n "${!v:-}" ] || { echo "ERROR: $v missing in .env"; exit 1; }
done

echo "== quick balance check (all actors need gas) =="
for v in ADMIN_PK KEEPER_PK VAULT_OPERATOR_PK LENDER1_PK LENDER2_PK BORROWER_PK AGENT4_PK AGENT5_PK; do
  A=$(cast wallet address --private-key "${!v}")
  B=$(cast balance "$A" --rpc-url "$RPC_LOCAL" -e)
  echo "  $v $A $B AVAX"
  [ "$B" != "0" ] || { echo "ERROR: $v has 0 AVAX — run scripts/fund_fuji.mjs"; exit 1; }
done

echo "== starting services against Fuji (indexer, control, keeper, agents, operator, admin) =="
# services start as `node <svc>/index.mjs` with cwd=services/, so match that form
pkill -f 'node (indexer|control|keeper|agents|operator|admin)/index.mjs' 2>/dev/null || true; sleep 2
cd "$ROOT/services"
node indexer/index.mjs   > /tmp/window_fuji_indexer.log 2>&1 &
node control/index.mjs   > /tmp/window_fuji_control.log 2>&1 &
node keeper/index.mjs    > /tmp/window_fuji_keeper.log 2>&1 &
node agents/index.mjs    > /tmp/window_fuji_agents.log 2>&1 &
node operator/index.mjs  > /tmp/window_fuji_operator.log 2>&1 &
node admin/index.mjs     > /tmp/window_fuji_admin.log 2>&1 &
echo "services started against Fuji. logs: /tmp/window_fuji_*.log — watch: tail -f /tmp/window_fuji_admin.log"
wait
