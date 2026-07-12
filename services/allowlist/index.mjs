// Allowlist keeper — permissioned-L1 only. Mirrors MemberRegistry membership into
// the Subnet-EVM TxAllowList precompile so ONLY registered members (plus the ops
// roles granted at genesis) can transact at the CHAIN level: membership in the
// money market IS permission to use the chain. MemberAdded -> setEnabled(who);
// MemberRemoved -> setNone(who). Admin-role addresses are never touched. Stateless:
// re-derives desired state from chain events every poll (same posture as keeper).
import { ethers, handles, queryAll } from "../lib/chain.mjs";
import { ADMIN_PK } from "../lib/roles.mjs";
import "dotenv/config";

const POLL_MS = Number(process.env.ALLOWLIST_POLL_MS || 5000);
const PRECOMPILE = "0x0200000000000000000000000000000000000002"; // TxAllowList
const ABI = [
  "function setEnabled(address addr)",
  "function setNone(address addr)",
  "function readAllowList(address addr) view returns (uint256)", // 0 none, 1 enabled, 2 admin
];

const H = handles(ADMIN_PK);
// share the admin bundle's NonceManager — a second one for the same key would desync
const allow = new ethers.Contract(PRECOMPILE, ABI, H.registry.runner);

async function tick() {
  try {
    const added = await queryAll(H.registry, H.registry.filters.MemberAdded());
    const removed = await queryAll(H.registry, H.registry.filters.MemberRemoved());
    const seen = new Set([...added, ...removed].map((e) => e.args.who.toLowerCase()));
    for (const who of seen) {
      const isMember = await H.registry.isMember(who);
      const role = await allow.readAllowList(who);
      if (role >= 2n) continue; // never demote chain admins
      if (isMember && role === 0n) {
        await (await allow.setEnabled(who)).wait();
        console.log(`[allowlist] enabled ${who} (MemberRegistry member)`);
      } else if (!isMember && role === 1n) {
        await (await allow.setNone(who)).wait();
        console.log(`[allowlist] revoked ${who} (membership removed)`);
      }
    }
  } catch (e) {
    // on chains without the precompile (Anvil/Fuji) readAllowList reverts — idle
    const m = e?.shortMessage || e?.message || String(e);
    if (/could not decode|revert|BAD_DATA/i.test(m)) {
      console.log("[allowlist] TxAllowList precompile not present on this chain — idle");
    } else {
      console.error("[allowlist]", m);
    }
  }
}

console.log("[allowlist] MemberRegistry -> TxAllowList sync running; poll", POLL_MS, "ms");
// self-scheduling: next tick starts POLL_MS after the previous finishes (a fixed
// setInterval overlaps itself while receipts confirm, double-sending set calls)
const loop = () => setTimeout(async () => { await tick(); loop(); }, POLL_MS);
(async () => { await tick(); loop(); })();
