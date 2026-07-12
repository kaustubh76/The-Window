#!/usr/bin/env bash
# Unattended story: start the full service stack (indexer + control + keeper +
# agents + operator + admin) with NO scenario script. The services autonomously
# open/close epochs, bid, print M-ONIA (real PoCD), and cycle loans (repay + default->seize).
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC="http://127.0.0.1:8545"

export RPC_LOCAL="$RPC" CHAIN_ID=31337 EPOCH_LEN=10 TENOR_BLOCKS=5 INDEXER_PORT=8787 CONTROL_PORT=8899 PROFILE=DEMO
export KEEPER_STALL_S=45 ADMIN_POLL_MS=3000 KEEPER_POLL_MS=2000 AGENTS_POLL_MS=2000 OPERATOR_POLL_MS=2000
# All actor keys explicit (anvil defaults) so the root .env's Fuji keys don't override.
export ADMIN_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export KEEPER_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
export VAULT_OPERATOR_PK=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
export LENDER1_PK=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
export LENDER2_PK=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a
export BORROWER_PK=0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba
export KEEPER_ADDR=$(cast wallet address --private-key "$KEEPER_PK")
export VAULT_OPERATOR_ADDR=$(cast wallet address --private-key "$VAULT_OPERATOR_PK")
export AUDITOR_BJJ_PRIV=2748579834902348905823409582340958234
export AUDITOR_BJJ_PUB_X=15126131017275559229883198140197230023892265818363501039953620538039205717764
export AUDITOR_BJJ_PUB_Y=7504911034826791718448377250227968384413910115391011404817860837847273794444

echo "== fresh anvil (interval mining so time advances) + deploy + register =="
pkill -f 'anvil' 2>/dev/null || true; pkill -f 'services/' 2>/dev/null || true
pkill -f 'index.mjs' 2>/dev/null || true; sleep 1
# --block-time 1: mine a block every second so block.timestamp advances for the
# time-based keeper (unattended). The scripted demo instead uses evm_increaseTime.
anvil --silent --block-time 1 > /tmp/window_anvil.log 2>&1 &
sleep 4
bash "$ROOT/scripts/deploy_local.sh" > /tmp/window_deploy.log 2>&1
node "$ROOT/packages/eerc-node/src/register_all.mjs"

echo "== starting services (keeper, agents, operator, admin, indexer, control) =="
cd "$ROOT/services"
node indexer/index.mjs   > /tmp/window_indexer.log 2>&1 &
node control/index.mjs   > /tmp/window_control.log 2>&1 &
node keeper/index.mjs    > /tmp/window_keeper.log 2>&1 &
node agents/index.mjs    > /tmp/window_agents.log 2>&1 &
node operator/index.mjs  > /tmp/window_operator.log 2>&1 &
node admin/index.mjs     > /tmp/window_admin.log 2>&1 &
echo "services started. logs in /tmp/window_*.log — watch: tail -f /tmp/window_admin.log"
wait
