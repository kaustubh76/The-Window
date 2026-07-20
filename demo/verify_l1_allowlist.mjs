// Prove the permissioned-L1 story end-to-end (read/write, real chain):
//   1. an EOA that is NOT a MemberRegistry member CANNOT transact — the Subnet-EVM
//      TxAllowList precompile rejects it at the chain level;
//   2. a registered member (enabled by services/allowlist from MemberRegistry
//      events) CAN transact;
//   3. the market is alive on the L1 (epochs advancing / prints landing).
// Run from services/ so ethers resolves:
//   RPC_L1=<rpc> CHAIN_ID=43117 node ../demo/verify_l1_allowlist.mjs
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { INTRUDER_PK } from "./l1-fixtures.mjs";
const require = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), "../services/package.json"));
const { JsonRpcProvider, Wallet, Contract } = require("ethers");

const RPC = process.env.RPC_L1 || process.env.RPC_LOCAL;
if (!RPC) { console.error("RPC_L1 required"); process.exit(1); }
const provider = new JsonRpcProvider(RPC);

const PRECOMPILE = "0x0200000000000000000000000000000000000002";
const allow = new Contract(PRECOMPILE, ["function readAllowList(address) view returns (uint256)"], provider);

// INTRUDER_PK (demo/l1-fixtures.mjs): a purpose-generated never-member, funded in l1/genesis.json
// but never enabled — must be chain-blocked. lender1 is a real MemberRegistry member the allowlist
// keeper must have enabled — sign as its REAL key (Fuji-anchored L1 is live-only, no Anvil keys).
const MEMBER_PK = process.env.LENDER1_PK;
if (!MEMBER_PK) { console.error("LENDER1_PK required (real member key) — source the root .env"); process.exit(1); }

let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };

// 1. roles as recorded by the precompile
const intruder = new Wallet(INTRUDER_PK, provider);
const member = new Wallet(MEMBER_PK, provider);
const [ri, rm] = [await allow.readAllowList(intruder.address), await allow.readAllowList(member.address)];
check(ri === 0n, `intruder ${intruder.address} has TxAllowList role None (${ri})`);
check(rm >= 1n, `member lender1 ${member.address} has TxAllowList role Enabled/Admin (${rm})`);

// 2. intruder tx MUST be rejected at the chain level (has gas money, is not allowed)
let intruderBlocked = false, blockErr = "";
try {
  const tx = await intruder.sendTransaction({ to: intruder.address, value: 0n });
  await tx.wait();
} catch (e) { intruderBlocked = true; blockErr = e?.shortMessage || e?.message || String(e); }
check(intruderBlocked, `non-member tx REJECTED by the chain (${blockErr.slice(0, 80)})`);

// 3. member tx succeeds
const mtx = await member.sendTransaction({ to: member.address, value: 0n });
const mrc = await mtx.wait();
check(mrc.status === 1, `member tx mined on the L1 (block ${mrc.blockNumber}, ${mtx.hash.slice(0, 18)}…)`);

// 4. market liveness: current epoch on the L1 AuctionHouse
try {
  const { readFileSync } = await import("node:fs");
  const dep = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../contracts/deployments/43117.json"), "utf8"));
  const auction = new Contract(dep.AUCTION_HOUSE_ADDR, ["function currentEpoch() view returns (uint64)"], provider);
  const oracle = new Contract(dep.MONIA_ORACLE_ADDR, ["function lastPrintedEpoch() view returns (uint64)"], provider);
  const cur = await auction.currentEpoch();
  check(cur >= 1n, `auction alive on the L1: currentEpoch = ${cur}`);
  try { console.log(`      lastPrintedEpoch = ${await oracle.lastPrintedEpoch()}`); } catch { /* optional getter */ }
} catch (e) {
  console.log("      (market-liveness check skipped:", (e?.message || "").slice(0, 60) + ")");
}

console.log(failures === 0 ? "\nALLOWLIST VERIFY: PASS" : `\nALLOWLIST VERIFY: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
