// Shared chain access for THE WINDOW services: provider, wallets, contract handles,
// and ABIs loaded from the Foundry build output + deployments JSON.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ethers } from "ethers";
import "dotenv/config";

export { ethers };

const __dir = dirname(fileURLToPath(import.meta.url));
const CROOT = resolve(__dir, "../../contracts");

export const RPC = process.env.RPC_LOCAL || "http://127.0.0.1:8545";
export const CHAIN_ID = Number(process.env.CHAIN_ID || 31337);
export const provider = new ethers.JsonRpcProvider(RPC);

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
// IMPORTANT: all contracts for a given account share ONE NonceManager/signer, so
// sending across multiple contracts from the same EOA keeps nonces in sync.
export function handles(signerPk) {
  const d = deployments();
  const runner = signerPk ? wallet(signerPk) : provider;
  const c = (addr, name) => new ethers.Contract(addr, abi(name), runner);
  return {
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
}
