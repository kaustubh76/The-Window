// Shared chain access for THE WINDOW services: provider, wallets, contract handles,
// and ABIs loaded from the Foundry build output + deployments JSON.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ethers } from "ethers";
import "dotenv/config";

export { ethers };

// Public RPCs (Fuji) intermittently 500; ethers' internal polling can surface that
// as an unhandled rejection outside any caller's try/catch. Log and keep running —
// every service loop is otherwise idempotent and retries on its next poll.
process.on("unhandledRejection", (err) => {
  console.error("[chain] unhandled rejection (continuing):", err?.shortMessage || err?.message || err);
});

const __dir = dirname(fileURLToPath(import.meta.url));
const CROOT = resolve(__dir, "../../contracts");

export const RPC = process.env.RPC_LOCAL || "http://127.0.0.1:8545";
export const CHAIN_ID = Number(process.env.CHAIN_ID || 31337);
export const provider = new ethers.JsonRpcProvider(RPC);

// Earliest block worth scanning for events (set to the deployment block on real
// networks — public RPCs cap eth_getLogs ranges, e.g. Fuji at 2048 blocks).
export const START_BLOCK = Number(process.env.START_BLOCK || 0);
const LOG_WINDOW = Number(process.env.LOG_WINDOW || 2000);

// queryFilter that respects public-RPC getLogs range caps: paginates in
// LOG_WINDOW-block windows from START_BLOCK (or `from`) to latest. On local
// chains (window >= chain height) this collapses to a single call.
export async function queryAll(contract, filter, from = START_BLOCK) {
  const latest = await provider.getBlockNumber();
  if (latest - from <= LOG_WINDOW) return contract.queryFilter(filter, from, "latest");
  const out = [];
  for (let lo = from; lo <= latest; lo += LOG_WINDOW + 1) {
    const hi = Math.min(lo + LOG_WINDOW, latest);
    out.push(...await contract.queryFilter(filter, lo, hi));
  }
  return out;
}

export function deployments() {
  return JSON.parse(readFileSync(`${CROOT}/deployments/${CHAIN_ID}.json`, "utf8"));
}

export function abi(name, sol = name) {
  return JSON.parse(readFileSync(`${CROOT}/out/${sol}.sol/${name}.json`, "utf8")).abi;
}

export function wallet(pk) {
  return new ethers.NonceManager(new ethers.Wallet(pk, provider));
}

export function contract(addr, name, signerOrPk) {
  const runner = typeof signerOrPk === "string" ? wallet(signerOrPk) : (signerOrPk || provider);
  return new ethers.Contract(addr, abi(name), runner);
}

// Convenience handles built from deployments + a signer (optional).
// IMPORTANT: all contracts for a given account share ONE NonceManager/signer, AND
// repeated handles(pk) calls return the SAME cached bundle — so nonces stay in sync
// across every contract and every call site for that EOA.
const _handleCache = new Map();
export function handles(signerPk) {
  const key = signerPk || "__read__";
  if (_handleCache.has(key)) return _handleCache.get(key);
  const d = deployments();
  const runner = signerPk ? wallet(signerPk) : provider;
  const c = (addr, name) => new ethers.Contract(addr, abi(name), runner);
  const bundle = {
    d,
    usdc: c(d.TESTUSDC_ADDR, "SimpleERC20"),
    eerc: c(d.EERC_ADDR, "EncryptedERC"),
    registrar: c(d.REGISTRAR_ADDR, "Registrar"),
    registry: c(d.MEMBER_REGISTRY_ADDR, "MemberRegistry"),
    auction: c(d.AUCTION_HOUSE_ADDR, "AuctionHouse"),
    oracle: c(d.MONIA_ORACLE_ADDR, "MONIAOracle"),
    vault: c(d.COLLATERAL_VAULT_ADDR, "CollateralVault"),
    book: c(d.LOAN_BOOK_ADDR, "LoanBook"),
  };
  _handleCache.set(key, bundle);
  return bundle;
}
