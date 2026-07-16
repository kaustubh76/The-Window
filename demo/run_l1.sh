#!/usr/bin/env bash
# PERMISSIONED-L1 story: THE WINDOW on a sovereign Avalanche L1 where MemberRegistry
# membership IS chain access — services/allowlist mirrors membership into the
# Subnet-EVM TxAllowList precompile, so non-members cannot transact AT ALL.
#
# One-time L1 setup (avalanche-cli >= 1.9, https://github.com/ava-labs/avalanche-cli):
#   avalanche blockchain create thewindowl1 --evm --genesis l1/genesis.json \
#     --proof-of-authority \
#     --validator-manager-owner 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
#     --proxy-contract-owner   0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
#     --evm-token WIN --latest --icm=false
#   avalanche blockchain deploy thewindowl1 --local
#
# Run:  RPC_L1="<RPC Endpoint from: avalanche blockchain describe thewindowl1>" bash demo/run_l1.sh
#
# Zero secrets (Anvil default keys + fixed demo auditor, like run_demo/run_autonomous).
# Uses ports 8788/8900 so it can run ALONGSIDE the Fuji stack (8787/8899); services
# started here are tracked in /tmp/window_l1_pids and re-runs only kill those.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

: "${RPC_L1:?RPC_L1 required — see: avalanche blockchain describe thewindowl1}"
CHAINID_HEX=$(curl -s -m 5 -X POST "$RPC_L1" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | sed -E 's/.*"result":"([^"]+)".*/\1/')
[ "$CHAINID_HEX" = "0xa86d" ] || { echo "ERROR: RPC_L1 is not thewindowl1 (chainId $CHAINID_HEX != 0xa86d/43117)"; exit 1; }

# stop a previous L1 service stack (never touches the Fuji services)
if [ -f /tmp/window_l1_pids ]; then xargs kill < /tmp/window_l1_pids 2>/dev/null || true; rm -f /tmp/window_l1_pids; sleep 1; fi

# ---- env: Anvil default keys + demo auditor (public test values) ----
export RPC_LOCAL="$RPC_L1" CHAIN_ID=43117 PROFILE=DEMO
export EPOCH_LEN="${EPOCH_LEN:-60}" TENOR_BLOCKS="${TENOR_BLOCKS:-20}" KEEPER_STALL_S=120 BLOCK_SEC=2
export INDEXER_PORT=8788 CONTROL_PORT=8900
export READ_GATE=1   # L1 read surface is member-gated (only members can OBSERVE the market)
export ADMIN_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export KEEPER_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
export VAULT_OPERATOR_PK=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
export LENDER1_PK=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
export LENDER2_PK=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a
export BORROWER_PK=0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba
export AGENT4_PK=0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e
export AGENT5_PK=0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356
export AUDITOR_BJJ_PRIV=2748579834902348905823409582340958234
export AUDITOR_BJJ_PUB_X=15126131017275559229883198140197230023892265818363501039953620538039205717764
export AUDITOR_BJJ_PUB_Y=7504911034826791718448377250227968384413910115391011404817860837847273794444
export ADMIN_POLL_MS=4000 KEEPER_POLL_MS=3000 AGENTS_POLL_MS=3000 OPERATOR_POLL_MS=3000 ALLOWLIST_POLL_MS=5000

# ---- deploy stack + register members (admin-only txs; members are still chain-blocked) ----
CODE=$(curl -s -m 5 -X POST "$RPC_L1" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getCode","params":["'"$(python3 -c "import json;print(json.load(open('$ROOT/contracts/deployments/43117.json'))['AUCTION_HOUSE_ADDR'])" 2>/dev/null || echo 0x0000000000000000000000000000000000000000)"'","latest"]}' | sed -E 's/.*"result":"([^"]+)".*/\1/')
if [ "${CODE:-0x}" = "0x" ]; then
  echo "== [1/4] deploying WINDOW stack to the L1 =="
  SNOWTRACE_API_KEY=dummy RPC_L1="$RPC_L1" bash "$ROOT/scripts/deploy_l1.sh"
else
  echo "== [1/4] stack already deployed on the L1 =="
fi

echo "== [2/4] register members (MemberRegistry) + eERC auditor =="
cp "$ROOT/dashboard/.env" /tmp/dashboard.env.bak 2>/dev/null || true
(cd "$ROOT/packages/eerc-node" && node src/register_all.mjs)
[ -f /tmp/dashboard.env.bak ] && cp /tmp/dashboard.env.bak "$ROOT/dashboard/.env"  # keep local dashboard config

echo "== [3/4] allowlist keeper: MemberRegistry -> TxAllowList =="
cd "$ROOT/services"
nohup node allowlist/index.mjs > /tmp/window_l1_allowlist.log 2>&1 & echo $! >> /tmp/window_l1_pids
# wait until all five members are chain-enabled
for i in $(seq 1 24); do
  N=$(node -e '
    const {ethers} = await import("ethers");
    const p = new ethers.JsonRpcProvider(process.env.RPC_LOCAL);
    const allow = new ethers.Contract("0x0200000000000000000000000000000000000002",
      ["function readAllowList(address) view returns (uint256)"], p);
    const members = ["0x90F79bf6EB2c4f870365E785982E1f101E93b906","0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
      "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc","0x976EA74026E726554dB657fA54763abd0C3a0aa9",
      "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955"];
    let n = 0; for (const m of members) if ((await allow.readAllowList(m)) >= 1n) n++;
    console.log(n);' --input-type=module 2>/dev/null || echo 0)
  echo "  members chain-enabled: $N/5"; [ "$N" = "5" ] && break; sleep 5
done

echo "== [4/4] starting the market (indexer :8788, control :8900, daemons) =="
for svc in keeper agents operator admin; do
  nohup node $svc/index.mjs > /tmp/window_l1_$svc.log 2>&1 & echo $! >> /tmp/window_l1_pids
done
nohup node indexer/index.mjs > /tmp/window_l1_indexer.log 2>&1 & echo $! >> /tmp/window_l1_pids
nohup node control/index.mjs > /tmp/window_l1_control.log 2>&1 & echo $! >> /tmp/window_l1_pids

sleep 8
echo "== proof: membership == chain access (write-gate) =="
RPC_L1="$RPC_L1" node "$ROOT/demo/verify_l1_allowlist.mjs" || true
echo
echo "== proof: membership == observation (read-gate) =="
READGATE_URL="http://127.0.0.1:8788" node "$ROOT/demo/verify_l1_readgate.mjs" || true
echo
echo "== proof: atomic revocation (market + eERC + network + observation) =="
RPC_L1="$RPC_L1" READGATE_URL="http://127.0.0.1:8788" node "$ROOT/demo/verify_l1_revoke.mjs" || true
echo
echo "== what a competitor sees: public Fuji vs the L1 =="
READGATE_URL="http://127.0.0.1:8788" node "$ROOT/demo/what_a_competitor_sees.mjs" || true
echo
echo "L1 stack running. logs: /tmp/window_l1_*.log · indexer http://127.0.0.1:8788 (READ_GATE on) · stop: xargs kill < /tmp/window_l1_pids"
echo "Dashboard on the L1 (member-gated reads + /l1 story page):  cd dashboard && npm run dev -- --mode l1"
