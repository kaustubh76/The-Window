// Prove READ-privacy on the permissioned L1: the market's read surface is
// member-gated, so a NON-member cannot even OBSERVE the auction — closing the
// participation leak eERC can't close on a public chain.
//   1. no signature            -> 403 (open reads are refused);
//   2. non-member signature     -> 403 (valid sig, but not a MemberRegistry member);
//   3. member signature         -> 200 (a member sees the data).
// Requires the L1 indexer running with READ_GATE=1 (demo/run_l1.sh sets it).
// Run:  READGATE_URL=http://127.0.0.1:8788 node demo/verify_l1_readgate.mjs
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const require = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), "../services/package.json"));
const { Wallet } = require("ethers");

const URL = process.env.READGATE_URL || process.env.INDEXER_L1_URL || "http://127.0.0.1:8788";
// Anvil #3 = lender1 — a MemberRegistry member. Anvil #8 = the never-member intruder.
const MEMBER_PK = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const INTRUDER_PK = "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97";

// Must match services/indexer/index.mjs readChallenge(): window-read:<floor(now/30s)>
const challenge = () => `window-read:${Math.floor(Date.now() / 30000)}`;
async function signedHeaders(pk) {
  const w = new Wallet(pk);
  return { "x-window-address": w.address, "x-window-sig": await w.signMessage(challenge()) };
}
async function get(path, headers = {}) {
  const r = await fetch(`${URL}${path}`, { headers });
  return { status: r.status, body: await r.text() };
}

let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };

// 0. /health is always open (liveness must not require membership)
const health = await get("/health");
check(health.status === 200, `/health open without membership (${health.status})`);

// 1. an unauthenticated read of the participation surface is refused
const anon = await get("/members");
check(anon.status === 403, `anonymous read of /members REFUSED (${anon.status})`);

// 2. a valid signature from a NON-member is still refused
const intruder = await get("/members", await signedHeaders(INTRUDER_PK));
check(intruder.status === 403, `non-member signed read REFUSED (${intruder.status})`);

// 3. a member signature is admitted and sees the data
const member = await get("/members", await signedHeaders(MEMBER_PK));
let count = -1;
try { count = JSON.parse(member.body).length; } catch { /* non-JSON on failure */ }
check(member.status === 200, `member signed read ADMITTED (${member.status}, ${count} members visible)`);

console.log(
  failures === 0
    ? "\nREADGATE VERIFY: PASS — only members can observe the L1 market"
    : `\nREADGATE VERIFY: ${failures} FAILURE(S) (is the L1 indexer up with READ_GATE=1 on ${URL}?)`,
);
process.exit(failures === 0 ? 0 : 1);
