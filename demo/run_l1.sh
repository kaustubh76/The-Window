#!/usr/bin/env bash
# PERMISSIONED-L1 story: THE WINDOW on a sovereign Avalanche L1 where MemberRegistry
# membership IS chain access — services/allowlist mirrors membership into the
# Subnet-EVM TxAllowList precompile, so non-members cannot transact AT ALL.
#
# One-time L1 setup (avalanche-cli >= 1.9, https://github.com/ava-labs/avalanche-cli):
#   avalanche blockchain create thewindowl1 --evm --genesis l1/genesis.json \
#     --proof-of-authority \
#     --validator-manager-owner 0x6358c6B980fad929247b932207893b4dB2F7cd82 \
#     --proxy-contract-owner   0x6358c6B980fad929247b932207893b4dB2F7cd82 \
#     --evm-token WIN --latest --icm=false
#   avalanche blockchain deploy thewindowl1 --local   # (or --fuji -k windowdeployer to anchor to Fuji)
#
# Run:  RPC_L1="<RPC Endpoint from: avalanche blockchain describe thewindowl1>" bash demo/run_l1.sh
#
# Live-only: real role keys + auditor come from the root .env (no Anvil), matching
# l1/genesis.json's real TxAllowList admin/enabled roles. Uses ports 8788/8900 so it can run
# ALONGSIDE the Fuji stack (8787/8899); services started here are tracked in /tmp/window_l1_pids
# and re-runs only kill those.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

: "${RPC_L1:?RPC_L1 required — see: avalanche blockchain describe thewindowl1}"
CHAINID_HEX=$(curl -s -m 5 -X POST "$RPC_L1" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | sed -E 's/.*"result":"([^"]+)".*/\1/')
[ "$CHAINID_HEX" = "0xa86d" ] || { echo "ERROR: RPC_L1 is not thewindowl1 (chainId $CHAINID_HEX != 0xa86d/43117)"; exit 1; }

# stop a previous L1 service stack (never touches the Fuji services)
if [ -f /tmp/window_l1_pids ]; then xargs kill < /tmp/window_l1_pids 2>/dev/null || true; rm -f /tmp/window_l1_pids; sleep 1; fi

# ---- env: real role keys + auditor from the root .env (live-only, no Anvil) ----
[ -f "$ROOT/.env" ] || { echo "ERROR: root .env missing — the live-only L1 needs real keys"; exit 1; }
set -a; source "$ROOT/.env"; set +a
for v in ADMIN_PK KEEPER_PK VAULT_OPERATOR_PK LENDER1_PK LENDER2_PK BORROWER_PK AGENT4_PK AGENT5_PK AUDITOR_BJJ_PRIV AUDITOR_BJJ_PUB_X AUDITOR_BJJ_PUB_Y; do
  [ -n "${!v:-}" ] || { echo "ERROR: $v missing in .env — the live-only L1 requires real keys"; exit 1; }
done
# L1-specific overrides (come AFTER sourcing so they win over any Fuji values in .env).
# START_BLOCK=0: the L1 is a fresh chain from genesis — the indexer/allowlist keeper must scan
# from block 0, NOT the Fuji START_BLOCK carried in .env (which is past the L1's head → misses
# every MemberAdded/bid event, so members never get TxAllowList-enabled and nothing is indexed).
export RPC_LOCAL="$RPC_L1" CHAIN_ID=43117 PROFILE=DEMO START_BLOCK=0
export EPOCH_LEN="${EPOCH_LEN:-60}" TENOR_BLOCKS="${TENOR_BLOCKS:-20}" KEEPER_STALL_S=120 BLOCK_SEC=2
export INDEXER_PORT=8788 CONTROL_PORT=8900
export READ_GATE=1   # L1 read surface is member-gated (only members can OBSERVE the market)
export ADMIN_POLL_MS=4000 KEEPER_POLL_MS=3000 AGENTS_POLL_MS=3000 OPERATOR_POLL_MS=3000 ALLOWLIST_POLL_MS=5000

echo "== [0/4] preflight: driver keys ↔ l1/genesis.json ↔ WIN gas =="
node "$ROOT/scripts/preflight_l1.mjs"

# ---- deploy stack + register members (admin-only txs; members are still chain-blocked) ----
CODE=$(curl -s -m 5 -X POST "$RPC_L1" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getCode","params":["'"$(python3 -c "import json;print(json.load(open('$ROOT/contracts/deployments/43117.json'))['AUCTION_HOUSE_ADDR'])" 2>/dev/null || echo 0x0000000000000000000000000000000000000000)"'","latest"]}' | sed -E 's/.*"result":"([^"]+)".*/\1/')
if [ "${CODE:-0x}" = "0x" ]; then
  echo "== [1/4] deploying WINDOW stack to the L1 =="
  SNOWTRACE_API_KEY=dummy RPC_L1="$RPC_L1" bash "$ROOT/scripts/deploy_l1.sh"
else
  echo "== [1/4] stack already deployed on the L1 =="
fi

# guard the stale-deployment landmine: the live LoanBook's immutable admin MUST be our real ADMIN,
# else contracts/deployments/43117.json is stale (e.g. an old Anvil-admin deploy) and every
# onlyAdmin tx (print/match/fund/repay/addMember) would revert. Fail fast rather than limp.
LB_ADDR=$(python3 -c "import json;print(json.load(open('$ROOT/contracts/deployments/43117.json'))['LOAN_BOOK_ADDR'])")
ONCHAIN_ADMIN=$(cast call "$LB_ADDR" 'admin()(address)' --rpc-url "$RPC_L1" | tr 'A-F' 'a-f')
WANT_ADMIN=$(cast wallet address --private-key "$ADMIN_PK" | tr 'A-F' 'a-f')
[ "$ONCHAIN_ADMIN" = "$WANT_ADMIN" ] || { echo "FATAL: LoanBook.admin()=$ONCHAIN_ADMIN != ADMIN=$WANT_ADMIN — stale deployments/43117.json; redeploy."; exit 1; }
echo "  on-chain admin verified ✓ ($WANT_ADMIN)"

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
    // derive the 5 member addresses from the real keys (single source of truth; the preflight
    // already asserts these match l1/genesis.json, so no hardcoded list can drift out of sync)
    const members = ["LENDER1_PK","LENDER2_PK","BORROWER_PK","AGENT4_PK","AGENT5_PK"]
      .map((k) => new ethers.Wallet(process.env[k]).address);
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
