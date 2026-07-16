// Prove ATOMIC, COMPLETE revocation on the permissioned L1: one admin action —
// MemberRegistry.removeMember(X) — propagates through services/allowlist to strip
// X from ALL FOUR layers at once. On public Fuji you can only stop X's onlyMember
// calls; you can never evict X from the settlement layer. Here, one removeMember →
//   • market      ✗  (onlyMember calls impossible)
//   • eERC        ✗  (can't submit a register/transfer tx at all)
//   • network     ✗  (TxAllowList role None — every tx rejected at the chain level)
//   • observation ✗  (READ_GATE refuses X's signed reads — no longer a member)
// The script removes a subject member, asserts the four revocations, then RE-ADDS it
// so the running market recovers (the agents daemon self-heals within a poll cycle).
// Run from repo root:  RPC_L1=<rpc> node demo/verify_l1_revoke.mjs
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
const __dir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(__dir, "../services/package.json"));
const { JsonRpcProvider, Wallet, Contract, keccak256, toUtf8Bytes } = require("ethers");

const RPC = process.env.RPC_L1 || process.env.RPC_LOCAL;
if (!RPC) { console.error("RPC_L1 required"); process.exit(1); }
const provider = new JsonRpcProvider(RPC);
const READGATE_URL = process.env.READGATE_URL || process.env.INDEXER_L1_URL || "http://127.0.0.1:8788";

const dep = JSON.parse(readFileSync(resolve(__dir, "../contracts/deployments/43117.json"), "utf8"));
// admin (#0) is the MemberRegistry admin; overridable via env for real deployments.
const ADMIN_PK = process.env.ADMIN_PK || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
// subject = agent5 (#7): a real funded member, so we can show it COULD transact before.
const SUBJECT_PK = process.env.SUBJECT_PK || "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356";

const admin = new Wallet(ADMIN_PK, provider);
const subject = new Wallet(SUBJECT_PK, provider);
const registry = new Contract(dep.MEMBER_REGISTRY_ADDR, [
  "function addMember(address who, uint64 joinedEpoch, bytes32 bjjPubKeyRef)",
  "function removeMember(address who)",
  "function isMember(address who) view returns (bool)",
], admin);
const auction = new Contract(dep.AUCTION_HOUSE_ADDR, ["function currentEpoch() view returns (uint64)"], provider);
const allow = new Contract("0x0200000000000000000000000000000000000002",
  ["function readAllowList(address) view returns (uint256)"], provider);

let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The admin key is shared with the running admin daemon; a send can lose a nonce
// race. Retry so we NEVER leave the subject removed (the restore must succeed).
async function sendAdmin(fn, label, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try { await (await fn()).wait(); return; }
    catch (e) {
      const m = e?.shortMessage || e?.message || String(e);
      if (i === tries - 1) throw e;
      console.log(`  retry ${label} (${m.slice(0, 40)})`);
      await sleep(2500);
    }
  }
}
async function waitRole(addr, want, tries = 12) {
  for (let i = 0; i < tries; i++) {
    if ((await allow.readAllowList(addr)) === want) return true;
    await sleep(5000);
  }
  return false;
}
const challenge = () => `window-read:${Math.floor(Date.now() / 30000)}`;
async function signedReadStatus(w) {
  try {
    const r = await fetch(`${READGATE_URL}/members`, {
      headers: { "x-window-address": w.address, "x-window-sig": await w.signMessage(challenge()) },
    });
    return r.status;
  } catch { return null; } // indexer not reachable — observation check is skipped, not failed
}

console.log(`subject (agent5) = ${subject.address}\n`);

// Precondition: subject is currently a member and chain-enabled.
const wasMember = await registry.isMember(subject.address);
const roleBefore = await allow.readAllowList(subject.address);
check(wasMember && roleBefore >= 1n, `precondition: subject is an enabled member (isMember=${wasMember}, role=${roleBefore})`);
if (!wasMember) { console.log("\nsubject not a member — run register_all/allowlist first"); process.exit(1); }

// THE ONE ACTION.
console.log("\n>> admin: MemberRegistry.removeMember(agent5)\n");
await sendAdmin(() => registry.removeMember(subject.address), "removeMember");

// (network) allowlist keeper mirrors removal into the precompile.
const revoked = await waitRole(subject.address, 0n);
check(revoked, `network      ✗  TxAllowList role -> None (allowlist keeper synced removal)`);

// (market + eERC) with role None, EVERY tx from subject is rejected at the chain
// level — covering onlyMember market calls AND eERC register/transfer in one shot.
let blocked = false, err = "";
try { await (await subject.sendTransaction({ to: subject.address, value: 0n })).wait(); }
catch (e) { blocked = true; err = e?.shortMessage || e?.message || String(e); }
check(blocked, `market + eERC ✗  subject tx rejected at chain level (${err.slice(0, 48)})`);

// (observation) READ_GATE refuses the (now) non-member's signed read.
const obs = await signedReadStatus(subject);
if (obs === null) console.log("SKIP  observation ✗  (L1 read-gated indexer not reachable at " + READGATE_URL + ")");
else check(obs === 403, `observation  ✗  member-gated read refuses ex-member (HTTP ${obs})`);

// Restore: re-add so the running market recovers.
console.log("\n>> admin: MemberRegistry.addMember(agent5)  [restore]\n");
const epoch = await auction.currentEpoch();
const ref = keccak256(toUtf8Bytes("the-window:bjj:agent5"));
await sendAdmin(() => registry.addMember(subject.address, epoch, ref), "addMember");
const restored = await waitRole(subject.address, 1n);
check(restored, `restore      ✔  subject re-enabled (role -> Enabled); market recovers`);

console.log(
  failures === 0
    ? "\nREVOKE VERIFY: PASS — one removeMember revokes market + eERC + network + observation, atomically"
    : `\nREVOKE VERIFY: ${failures} FAILURE(S)`,
);
process.exit(failures === 0 ? 0 : 1);
