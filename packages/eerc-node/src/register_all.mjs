// F2 — post-deploy: add all bidding actors as MemberRegistry members, register the
// admin (auditor) in eERC + set the eERC auditor, and write dashboard/.env.
// Local actors are Anvil's pre-funded default keys (see services/lib/actors.mjs).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ethers } from "ethers";
import { ACTORS, MEMBER_NAMES } from "../../../services/lib/actors.mjs";
import { userFromRaw, genRegistrationProof } from "./eerc.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const CROOT = resolve(__dir, "../../../contracts");
const ROOT = resolve(__dir, "../../..");
const RPC = process.env.RPC_LOCAL || "http://127.0.0.1:8545";
const CHAIN_ID = Number(process.env.CHAIN_ID || 31337);
const provider = new ethers.JsonRpcProvider(RPC);
const dep = JSON.parse(readFileSync(`${CROOT}/deployments/${CHAIN_ID}.json`, "utf8"));
const abi = (n, s = n) => JSON.parse(readFileSync(`${CROOT}/out/${s}.sol/${n}.json`, "utf8")).abi;

const admin = new ethers.NonceManager(new ethers.Wallet(ACTORS.admin.pk, provider));
const registry = new ethers.Contract(dep.MEMBER_REGISTRY_ADDR, abi("MemberRegistry"), admin);
const registrar = new ethers.Contract(dep.REGISTRAR_ADDR, abi("Registrar"), admin);
const eerc = new ethers.Contract(dep.EERC_ADDR, abi("EncryptedERC"), admin);

// 1. MemberRegistry membership for every bidding actor
for (const name of MEMBER_NAMES) {
  const a = ACTORS[name];
  if (await registry.isMember(a.address)) { console.log(`${name} already member`); continue; }
  await (await registry.addMember(a.address, 1, ethers.ZeroHash)).wait();
  console.log(`added member ${name} (${a.address.slice(0, 10)})`);
}

// 2. Register the admin in eERC with its deterministic BJJ key, then set the eERC
//    auditor (enables converter deposits / the wrap flow). Non-fatal if it fails.
try {
  if (!(await registrar.isUserRegistered(ACTORS.admin.address))) {
    const user = userFromRaw(ACTORS.admin.bjjRaw);
    const p = await genRegistrationProof(user, ACTORS.admin.address, CHAIN_ID);
    await (await registrar.register({ proofPoints: { a: p.a, b: p.b, c: p.c }, publicSignals: p.publicSignals })).wait();
    console.log("registered admin in eERC");
  }
  if (!(await eerc.isAuditorKeySet())) {
    await (await eerc.setAuditorPublicKey(ACTORS.admin.address)).wait();
    console.log("eERC auditor set to admin");
  }
} catch (e) {
  console.warn("eERC auditor setup skipped:", e.message);
}

// 3. dashboard/.env
const denv = [
  "VITE_ADAPTER=live",
  "VITE_PROFILE=DEMO",
  `VITE_CHAIN_ID=${CHAIN_ID}`,
  `VITE_RPC_LOCAL=${RPC}`,
  // the dashboard live path reads VITE_RPC_FUJI when VITE_CHAIN_ID === 43113
  ...(CHAIN_ID === 43113 ? [`VITE_RPC_FUJI=${RPC}`] : []),
  `VITE_INDEXER_URL=http://127.0.0.1:${process.env.INDEXER_PORT || 8787}`,
  `VITE_CONTROL_URL=http://127.0.0.1:${process.env.CONTROL_PORT || 8899}`,
  `VITE_TESTUSDC_ADDR=${dep.TESTUSDC_ADDR}`,
  `VITE_EERC_ADDR=${dep.EERC_ADDR}`,
  `VITE_REGISTRAR_ADDR=${dep.REGISTRAR_ADDR}`,
  `VITE_MEMBER_REGISTRY_ADDR=${dep.MEMBER_REGISTRY_ADDR}`,
  `VITE_AUCTION_HOUSE_ADDR=${dep.AUCTION_HOUSE_ADDR}`,
  `VITE_MONIA_ORACLE_ADDR=${dep.MONIA_ORACLE_ADDR}`,
  `VITE_COLLATERAL_VAULT_ADDR=${dep.COLLATERAL_VAULT_ADDR}`,
  `VITE_LOAN_BOOK_ADDR=${dep.LOAN_BOOK_ADDR}`,
  `VITE_ADMIN_ADDR=${dep.ADMIN_ADDR}`,
  `VITE_KEEPER_ADDR=${dep.KEEPER_ADDR}`,
  "",
].join("\n");
writeFileSync(`${ROOT}/dashboard/.env`, denv);
console.log("wrote dashboard/.env (VITE_ADAPTER=live, control + indexer URLs)");
console.log("register_all done.");
process.exit(0); // ethers provider polling keeps the event loop alive otherwise
