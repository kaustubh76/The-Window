// Reusable admin (auditor-key) operations — used by the autonomous admin loop AND
// the Control API. The ONLY plaintext surface. HARD RULE: never log plaintext sizes.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { handles } from "./chain.mjs";
import { AUDITOR } from "./actors.mjs";
import { decryptEGCTDirect, genDepthArrayProof } from "../../packages/eerc-node/src/eerc.mjs";

const BUILD = resolve(dirname(fileURLToPath(import.meta.url)), "../../circuits/build");
const TICKS = 37;
export const NO_TRADE = 65535;

const egctObj = (r) => ({ c1: { x: r.c1.x, y: r.c1.y }, c2: { x: r.c2.x, y: r.c2.y } });

// JS port of MONIAOracle._computeClearing (must agree on-chain or postPrint reverts).
export function computeClearing(askSum, bidSum) {
  let demandFrom = bidSum.reduce((a, b) => a + b, 0n);
  let cumSupply = 0n;
  for (let t = 0; t < TICKS; t++) {
    cumSupply += askSum[t];
    if (cumSupply > 0n && demandFrom > 0n && cumSupply >= demandFrom) {
      return { crossing: t, matched: demandFrom < cumSupply ? demandFrom : cumSupply, trade: true };
    }
    demandFrom -= bidSum[t];
  }
  return { crossing: NO_TRADE, matched: 0n, trade: false };
}

// Read + decrypt per-tick aggregates under the auditor key.
export async function decryptDepth(H, epoch) {
  const ASK = Number(await H.auction.ASK());
  const BID = Number(await H.auction.BID());
  const askAgg = [], bidAgg = [], askSum = [], bidSum = [];
  for (let t = 0; t < TICKS; t++) {
    const a = await H.auction.getAggregate(epoch, ASK, t);
    const b = await H.auction.getAggregate(epoch, BID, t);
    askAgg.push(egctObj(a.egct)); bidAgg.push(egctObj(b.egct));
    askSum.push(BigInt(decryptEGCTDirect(AUDITOR.priv, egctObj(a.egct), 1 << 20)));
    bidSum.push(BigInt(decryptEGCTDirect(AUDITOR.priv, egctObj(b.egct), 1 << 20)));
  }
  return { askAgg, bidAgg, askSum, bidSum };
}

// Full print: decrypt -> compute r* -> real 37-tick PoCD -> postPrint. Returns summary.
export async function printEpoch(adminPk, epoch) {
  const H = handles(adminPk);
  if (Number(await H.auction.epochStatus(epoch)) !== 2) throw new Error("epoch not Closed");
  const { askAgg, bidAgg, askSum, bidSum } = await decryptDepth(H, epoch);
  const { crossing, matched, trade } = computeClearing(askSum, bidSum);
  const depth = askSum.map((a, t) => ({ askSum: a, bidSum: bidSum[t] }));

  const proof = await genDepthArrayProof(BUILD, AUDITOR.priv, AUDITOR.pub, askAgg, bidAgg, askSum, bidSum);
  const rStar = trade ? crossing : NO_TRADE;
  await (await H.oracle.postPrint(epoch, rStar, depth.map((d) => ({ askSum: d.askSum, bidSum: d.bidSum })), proof.a, proof.b, proof.c)).wait();
  return { epoch, rStarTick: rStar, rStarBps: trade ? 100 + 25 * crossing : null, matched: matched.toString(), trade };
}

// Pair lenders/borrowers at r* and postMatches. Returns created loan ids.
export async function matchEpoch(adminPk, epoch) {
  const H = handles(adminPk);
  const [rStar, exists] = await H.oracle.rateAt(epoch);
  if (!exists || Number(rStar) === NO_TRADE) return [];
  const r = Number(rStar);
  const lenders = [], borrowers = [];
  for (const ev of await H.auction.queryFilter(H.auction.filters.AskSubmitted(epoch), 0, "latest")) {
    if (Number(ev.args.tick) <= r) lenders.push(ev.args.who);
  }
  for (const ev of await H.auction.queryFilter(H.auction.filters.BidSubmitted(epoch), 0, "latest")) {
    if (Number(ev.args.tick) >= r) borrowers.push(ev.args.who);
  }
  const n = Math.min(lenders.length, borrowers.length);
  if (n === 0) return [];
  const zero = { c1: { x: 0n, y: 0n }, c2: { x: 0n, y: 0n } };
  const firstId = Number(await H.book.nextLoanId());
  const ms = [];
  for (let i = 0; i < n; i++) ms.push({ lender: lenders[i], borrower: borrowers[i], rateTick: r, cSize: zero });
  await (await H.book.postMatches(epoch, ms)).wait();
  return Array.from({ length: n }, (_, i) => firstId + i);
}

// Auditor-attested confirm/repay (LoanBook onlyAdmin).
export async function confirmFunding(adminPk, loanId) {
  const H = handles(adminPk);
  await (await H.book.confirmFunding(loanId, "0x" + "00".repeat(32))).wait();
}
export async function repay(adminPk, loanId) {
  const H = handles(adminPk);
  await (await H.book.repay(loanId, "0x" + "00".repeat(32))).wait();
}
