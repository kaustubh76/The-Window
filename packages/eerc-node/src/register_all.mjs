// F2 — post-deploy: add all actor EOAs as MemberRegistry members and write the
// dashboard .env. Local actors are Anvil's pre-funded default keys (override via
// process.env for Fuji). Agents bid with raw ElGamal, so they need MemberRegistry
// membership only (no eERC registration). eERC auditor is set for the wrap/transfer
// story (non-fatal if it fails — the loan lifecycle is auditor-attested).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ethers } from "ethers";

const __dir = dirname(fileURLToPath(import.meta.url));
const CROOT = resolve(__dir, "../../../contracts");
const ROOT = resolve(__dir, "../../..");
const RPC = process.env.RPC_LOCAL || "http://127.0.0.1:8545";
const CHAIN_ID = Number(process.env.CHAIN_ID || 31337);
const provider = new ethers.JsonRpcProvider(RPC);
const dep = JSON.parse(readFileSync(`${CROOT}/deployments/${CHAIN_ID}.json`, "utf8"));
const abi = (n, s = n) => JSON.parse(readFileSync(`${CROOT}/out/${s}.sol/${n}.json`, "utf8")).abi;

// Anvil default keys (pre-funded) — overridable via env.
const K = {
  admin: process.env.ADMIN_PK || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  keeper: process.env.KEEPER_PK || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  operator: process.env.VAULT_OPERATOR_PK || "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  lender1: process.env.LENDER1_PK || "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  lender2: process.env.LENDER2_PK || "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  borrower: process.env.BORROWER_PK || "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
};
const addr = Object.fromEntries(Object.entries(K).map(([k, pk]) => [k, new ethers.Wallet(pk).address]));

const admin = new ethers.NonceManager(new ethers.Wallet(K.admin, provider));
const registry = new ethers.Contract(dep.MEMBER_REGISTRY_ADDR, abi("MemberRegistry"), admin);

// members = everyone who submits bids / locks collateral
const members = ["lender1", "lender2", "borrower"];
for (const m of members) {
  if (await registry.isMember(addr[m])) { console.log(`${m} already member`); continue; }
  const tx = await registry.addMember(addr[m], 1, ethers.ZeroHash);
  await tx.wait();
  console.log(`added member ${m} (${addr[m].slice(0, 10)})`);
}

// dashboard/.env
const denv = [
  "VITE_ADAPTER=live",
  "VITE_PROFILE=DEMO",
  `VITE_CHAIN_ID=${CHAIN_ID}`,
  `VITE_RPC_LOCAL=${RPC}`,
  `VITE_INDEXER_URL=http://127.0.0.1:${process.env.INDEXER_PORT || 8787}`,
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
console.log("wrote dashboard/.env (VITE_ADAPTER=live)");
console.log("register_all done.");
