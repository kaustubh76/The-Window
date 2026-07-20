#!/usr/bin/env bash
# One-command local demo: fresh vanilla Anvil -> deploy+wire full stack
# with the REAL 37-tick verifier -> register members -> run the scripted full-epoch
# scenario (real proofs) -> start the indexer + live dashboard.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC="http://127.0.0.1:8545"

# ---- demo env (Anvil default pre-funded keys + the demo auditor scalar) ----
export RPC_LOCAL="$RPC" CHAIN_ID=31337 EPOCH_LEN=60 TENOR_BLOCKS=10 INDEXER_PORT=8787 PROFILE=DEMO
export ADMIN_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export KEEPER_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
export VAULT_OPERATOR_PK=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
export LENDER1_PK=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
export LENDER2_PK=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a
export BORROWER_PK=0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba
export KEEPER_ADDR=$(cast wallet address --private-key "$KEEPER_PK")
export VAULT_OPERATOR_ADDR=$(cast wallet address --private-key "$VAULT_OPERATOR_PK")
# demo auditor scalar S=2748579834902348905823409582340958234, pub = S·G
export AUDITOR_BJJ_PRIV=2748579834902348905823409582340958234
export AUDITOR_BJJ_PUB_X=15126131017275559229883198140197230023892265818363501039953620538039205717764
export AUDITOR_BJJ_PUB_Y=7504911034826791718448377250227968384413910115391011404817860837847273794444

echo "== [1/5] fresh anvil =="
pkill -f 'anvil' 2>/dev/null || true
pkill -f 'services/indexer' 2>/dev/null || true
pkill -f 'indexer/index.mjs' 2>/dev/null || true
sleep 1
anvil --silent > /tmp/window_anvil.log 2>&1 &
sleep 4

echo "== [2/5] deploy + wire full stack (real verifier) =="
bash "$ROOT/scripts/deploy_local.sh" >/tmp/window_deploy.log 2>&1
grep -iE 'MONIAOracle|real verifiers|SUCCESSFUL' /tmp/window_deploy.log || true

echo "== [3/5] register members + write dashboard/.env =="
node "$ROOT/packages/eerc-node/src/register_all.mjs"

echo "== [4/5] start indexer + control API =="
pkill -f 'services/control' 2>/dev/null || true
pkill -f 'control/index.mjs' 2>/dev/null || true
(cd "$ROOT/services" && node indexer/index.mjs > /tmp/window_indexer.log 2>&1 &)
(cd "$ROOT/services" && CONTROL_PORT=8899 node control/index.mjs > /tmp/window_control.log 2>&1 &)
sleep 2

echo "== [5/5] run scripted full-epoch scenario (REAL proofs; ~2 min) =="
node "$ROOT/demo/scenario.mjs"

echo ""
echo "Demo done. Start the dashboard:  cd dashboard && npm run dev"
echo "Indexer:  curl http://127.0.0.1:${INDEXER_PORT}/monia/latest"
echo "For the unattended-live story, run the services:  keeper / agents / admin (see services/)."
