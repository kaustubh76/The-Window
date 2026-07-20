// Preflight for the live-only permissioned L1 (thewindowl1, chainId 43117).
//
// Proves every driver signing key's ADDRESS is exactly what l1/genesis.json bakes in, so no
// on-chain tx can revert for "not admin / not enabled / no gas" after a real-key deploy:
//   - ADMIN_PK            -> must be the sole txAllowList adminAddresses entry
//   - KEEPER/OPERATOR     -> must be txAllowList enabledAddresses
//   - the 5 baked members -> must be prefunded in alloc (they're TxAllowList-enabled at runtime
//                            by the allowlist keeper once addMember fires, so they need gas only)
//   - every signer        -> must be prefunded in alloc (native WIN gas)
//   - auditor BJJ keys set (no local fallback on 43117 — actors.mjs fails loud without them)
//
// Addresses are DERIVED from the .env keys and compared; key VALUES are never printed.
// Run:  cd services && node ../scripts/preflight_l1.mjs        (add RPC_L1=<url> for gas checks)
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { INTRUDER_ADDR } from "../demo/l1-fixtures.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dir, "../.env") });
const require = createRequire(resolve(__dir, "../services/package.json"));
const { Wallet, JsonRpcProvider, formatEther } = require("ethers");

const genesis = JSON.parse(readFileSync(resolve(__dir, "../l1/genesis.json"), "utf8"));
const tx = genesis.config?.txAllowListConfig ?? {};
const norm = (a) => String(a).toLowerCase().replace(/^0x/, "");
const adminSet = new Set((tx.adminAddresses ?? []).map(norm));
const enabledSet = new Set((tx.enabledAddresses ?? []).map(norm));
const allocSet = new Set(Object.keys(genesis.alloc ?? {}).map(norm));

// signing key -> required genesis placement
const ROLES = [
  ["ADMIN_PK", "admin"],
  ["KEEPER_PK", "enabled"],
  ["VAULT_OPERATOR_PK", "enabled"],
  ["LENDER1_PK", "member"],
  ["LENDER2_PK", "member"],
  ["BORROWER_PK", "member"],
  ["AGENT4_PK", "member"],
  ["AGENT5_PK", "member"],
];

const errors = [];
const addrs = {};
console.log("== L1 preflight: keys ↔ l1/genesis.json ==");
for (const [env, kind] of ROLES) {
  const pk = process.env[env];
  if (!pk) { errors.push(`${env} missing in .env`); continue; }
  let addr;
  try { addr = new Wallet(pk.startsWith("0x") ? pk : "0x" + pk).address; }
  catch { errors.push(`${env} is not a valid private key`); continue; }
  addrs[env] = addr;
  const n = norm(addr);
  if (!allocSet.has(n)) errors.push(`${env} → ${addr} NOT in genesis alloc (no WIN gas on the L1)`);
  if (kind === "admin" && !adminSet.has(n)) errors.push(`${env} → ${addr} NOT in txAllowList adminAddresses`);
  if (kind === "enabled" && !enabledSet.has(n)) errors.push(`${env} → ${addr} NOT in txAllowList enabledAddresses`);
  const role = kind === "admin" ? "admin (2)" : kind === "enabled" ? "enabled (genesis)" : "member (keeper-enabled)";
  console.log(`  ${env.padEnd(18)} ${addr}  ${role}`);
}

for (const v of ["AUDITOR_BJJ_PRIV", "AUDITOR_BJJ_PUB_X", "AUDITOR_BJJ_PUB_Y"]) {
  if (!process.env[v]) errors.push(`${v} missing in .env (required on the live-only L1 — no fallback)`);
}

// intruder fixture (demo/l1-fixtures.mjs): funded in alloc but NEVER admin/enabled — the
// funded-but-blocked negative test. Its address must match l1/genesis.json exactly.
{
  const n = norm(INTRUDER_ADDR);
  if (!allocSet.has(n)) errors.push(`intruder ${INTRUDER_ADDR} NOT in genesis alloc (l1-fixtures.mjs ↔ genesis drift)`);
  if (adminSet.has(n) || enabledSet.has(n)) errors.push(`intruder ${INTRUDER_ADDR} must NOT be txAllowList admin/enabled`);
  console.log(`  ${"INTRUDER".padEnd(18)} ${INTRUDER_ADDR}  never-member (funded, not enabled)`);
}

// Optional on-chain gas check — ONLY against an explicit L1 RPC (never the ambient RPC_LOCAL,
// which points at Fuji in the shared .env). Genesis alloc funds these at block 0.
const RPC_L1 = process.env.RPC_L1;
if (RPC_L1 && !errors.length) {
  try {
    const p = new JsonRpcProvider(RPC_L1);
    const net = await p.getNetwork();
    if (Number(net.chainId) !== 43117) {
      errors.push(`RPC (${RPC_L1}) chainId ${net.chainId} != 43117 — not thewindowl1`);
    } else {
      console.log("== on-chain WIN gas (chainId 43117) ==");
      for (const [env, addr] of Object.entries(addrs)) {
        const bal = await p.getBalance(addr);
        console.log(`  ${env.padEnd(18)} ${formatEther(bal)} WIN`);
        if (bal === 0n) errors.push(`${env} → ${addr} has 0 WIN gas on the L1`);
      }
    }
  } catch (e) { console.log(`  (on-chain gas check skipped: ${e.message})`); }
}

if (errors.length) {
  console.error("\nPREFLIGHT FAILED — genesis/keys are inconsistent; L1 txs would revert:");
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log("\n✓ preflight OK — every driver key's address matches l1/genesis.json (admin/enabled/alloc).");
