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

// CHAIN_ID selects deployments/<id>.json — with a mismatched RPC a service would
// silently send txs to another network's addresses. Fail fast on the first
// answer instead (an unreachable RPC is fine: every service loop retries).
provider.getNetwork().then((n) => {
  if (Number(n.chainId) !== CHAIN_ID) {
    console.error(`[chain] FATAL: RPC ${RPC} reports chain ${n.chainId}, expected CHAIN_ID=${CHAIN_ID} (deployments/${CHAIN_ID}.json)`);
    process.exit(1);
  }
}).catch(() => {});

// Earliest block worth scanning for events (set to the deployment block on real
// networks — public RPCs cap eth_getLogs ranges, e.g. Fuji at 2048 blocks).
export const START_BLOCK = Number(process.env.START_BLOCK || 0);
const LOG_WINDOW = Number(process.env.LOG_WINDOW || 2000);

// queryFilter that respects public-RPC getLogs range caps: paginates in
// LOG_WINDOW-block windows from START_BLOCK (or `from`) to `to` (default:
// latest). On local chains (window >= chain height) this collapses to a
// single call. `to` lets callers pin one head for many filters (and advance
// an incremental cursor consistently).
export async function queryAll(contract, filter, from = START_BLOCK, to) {
  const latest = to ?? await provider.getBlockNumber();
  if (from > latest) return [];
  if (latest - from <= LOG_WINDOW) return contract.queryFilter(filter, from, latest);
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

// Nonce assignment that survives BOTH failure modes we've hit:
//  (a) cross-process desync — another process sharing the key (agents/admin/control sign for the
//      same actors) moves the account's nonce out from under us (stranded the market twice:
//      NoTrade streak; admin stuck NONCE_EXPIRED for hours);
//  (b) rapid same-process sequential sends on an instant-mining chain (Anvil / subnet-EVM), where
//      re-reading the "pending" count right after a mine returns a STALE value, so two back-to-back
//      sends (e.g. onboarding's register→faucet→wrap) grab the same nonce → NONCE_EXPIRED.
// Fix: take max(chain "latest" count, local high-water mark). "latest" re-syncs to external moves;
// the high-water mark guarantees strictly-increasing nonces across rapid local sends the chain
// hasn't caught up to yet. On a send failure we drop the mark so the next send re-syncs from chain.
class FreshNonceManager extends ethers.NonceManager {
  #next = null;
  async sendTransaction(tx) {
    const mined = await this.provider.getTransactionCount(await this.getAddress(), "latest");
    const nonce = this.#next == null ? mined : Math.max(this.#next, mined);
    this.#next = nonce + 1;
    try {
      return await this.signer.sendTransaction({ ...tx, nonce });
    } catch (e) {
      this.#next = null; // desync/failure → re-sync from chain next time
      throw e;
    }
  }
}

// Cache one signer per key so every call site for an EOA (handles(), the gas funder, ad-hoc sends)
// shares ONE FreshNonceManager. Two separate managers for the same account each re-read the pending
// nonce and can hand out the same value back-to-back (e.g. fund → addMember both as ADMIN) → a
// NONCE_EXPIRED collision. A single shared instance serializes that account's sends.
const _walletCache = new Map();
export function wallet(pk) {
  if (!_walletCache.has(pk)) _walletCache.set(pk, new FreshNonceManager(new ethers.Wallet(pk, provider)));
  return _walletCache.get(pk);
}

// Bound every send. ethers' tx.wait() polls indefinitely, and eth_sendRawTransaction can hang on a
// flaky public RPC — either silently freezes a driver's single-threaded loop FOREVER (no crash, so
// the supervisor's exit-only restart never fires; the market's prints stall while agents keep
// bidding). Race the whole send+confirm against a timeout and THROW on expiry so the caller's tick
// catches, logs, and retries next round. Safe with FreshNonceManager: it re-syncs the nonce from
// the chain's pending count before each send, so a timed-out tx that lands late doesn't desync the
// next attempt. Pass the contract-call promise (or a TransactionResponse) as `txOrPromise`.
export async function waitTx(txOrPromise, { timeoutMs = 90_000, confirmations = 1, label = "" } = {}) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`tx ${label || ""} not mined in ${Math.round(timeoutMs / 1000)}s`.replace("  ", " "))),
      timeoutMs,
    );
  });
  const settle = (async () => {
    const tx = await txOrPromise; // resolves the send itself (also bounded by the race)
    const rc = await tx.wait(confirmations);
    return { rc, tx };
  })();
  try {
    return await Promise.race([settle, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// waitTx + retry on a nonce collision (NONCE_EXPIRED / "nonce too low"). The admin key is shared
// across processes (admin daemon + control) and, on instant-mining chains, two back-to-back sends
// from one account can momentarily read the same pending nonce. FreshNonceManager re-syncs from the
// chain on each send, so a short pause + retry lands the next free nonce. Mirrors control's sendAdmin.
export async function sendTx(makeCall, { tries = 5, label = "" } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      return await waitTx(makeCall(), { label });
    } catch (e) {
      const s = String(e?.code || e?.shortMessage || e?.message || "");
      const nonceRace = /NONCE_EXPIRED|nonce too low|already been used|replacement/i.test(s);
      if (!nonceRace || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1500 + 500 * i));
    }
  }
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
