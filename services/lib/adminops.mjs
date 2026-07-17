// Reusable admin (auditor-key) operations — used by the autonomous admin loop AND
// the Control API. The ONLY plaintext surface. HARD RULE: never log plaintext sizes.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { handles, queryAll } from "./chain.mjs";
import { AUDITOR } from "./actors.mjs";
import { decryptEGCTDirect, genDepthArrayProof } from "../../packages/eerc-node/src/eerc.mjs";

const BUILD = resolve(dirname(fileURLToPath(import.meta.url)), "../../circuits/build");
const TICKS = 37;
export const NO_TRADE = 65535;

// BSGS ceiling for the per-tick aggregate decrypt. These are WHOLE-USDC scalar sums (agents bid
// tens-to-hundreds), so 2**31 (~2.1B units of summed depth per tick) is far above any real total
// while staying fast (√ ≈ 46k). NOTE: use 2**31, NOT 1<<31 — JS bitwise is 32-bit SIGNED, so
// 1<<31 is negative and Math.sqrt→NaN→BigInt throws. Matches memberops BALANCE_BSGS_MAX; over-
// ceiling would silently break the print/clearing (same failure mode fixed on the member path).
const DEPTH_BSGS_MAX = 2 ** 31;

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
    askSum.push(BigInt(decryptEGCTDirect(AUDITOR.priv, egctObj(a.egct), DEPTH_BSGS_MAX)));
    bidSum.push(BigInt(decryptEGCTDirect(AUDITOR.priv, egctObj(b.egct), DEPTH_BSGS_MAX)));
  }
  return { askAgg, bidAgg, askSum, bidSum };
}

// Full print: decrypt -> compute r* -> real chunked PoCD (4 x 10-tick proofs) -> postPrint.
export async function printEpoch(adminPk, epoch) {
  const H = handles(adminPk);
  if (Number(await H.auction.epochStatus(epoch)) !== 2) throw new Error("epoch not Closed");
  const { askAgg, bidAgg, askSum, bidSum } = await decryptDepth(H, epoch);
  const { crossing, matched, trade } = computeClearing(askSum, bidSum);
  const depth = askSum.map((a, t) => ({ askSum: a, bidSum: bidSum[t] }));

  const { proofs } = await genDepthArrayProof(BUILD, AUDITOR.priv, AUDITOR.pub, askAgg, bidAgg, askSum, bidSum);
  const rStar = trade ? crossing : NO_TRADE;
  const tx = await H.oracle.postPrint(
    epoch, rStar,
    depth.map((d) => ({ askSum: d.askSum, bidSum: d.bidSum })),
    proofs.map((p) => ({ a: p.a, b: p.b, c: p.c }))
  );
  const rc = await tx.wait();
  return { epoch, rStarTick: rStar, rStarBps: trade ? 100 + 25 * crossing : null, matched: matched.toString(), trade, txHash: tx.hash, gasUsed: rc.gasUsed.toString() };
}

// Pair lenders/borrowers at r* and postMatches. Returns created loan ids.
export async function matchEpoch(adminPk, epoch) {
  const H = handles(adminPk);
  const [rStar, exists] = await H.oracle.rateAt(epoch);
  if (!exists || Number(rStar) === NO_TRADE) return [];
  const r = Number(rStar);
  const lenders = [], borrowers = [];
  for (const ev of await queryAll(H.auction, H.auction.filters.AskSubmitted(epoch))) {
    if (Number(ev.args.tick) <= r) lenders.push(ev.args.who);
  }
  for (const ev of await queryAll(H.auction, H.auction.filters.BidSubmitted(epoch))) {
    if (Number(ev.args.tick) >= r) borrowers.push(ev.args.who);
  }
  const n = Math.min(lenders.length, borrowers.length);
  if (n === 0) return [];
  // INTENTIONAL (auditor-attested loan-value design): the matched per-loan size is NOT stored
  // on-chain. eERC transfer events carry no plaintext amount, so loan notionals are attested by
  // the auditor off-chain (see LoanBook NatSpec + METHODOLOGY.md), and Match/Loan.cSize is a
  // documented zero placeholder — not a dropped value. Consistent with attested fund/repay.
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
  const tx = await H.book.confirmFunding(loanId, "0x" + "00".repeat(32));
  const rc = await tx.wait();
  return { funded: String(loanId), txHash: tx.hash, gasUsed: rc.gasUsed.toString() };
}
export async function repay(adminPk, loanId) {
  const H = handles(adminPk);
  const tx = await H.book.repay(loanId, "0x" + "00".repeat(32));
  const rc = await tx.wait();
  return { repaid: String(loanId), txHash: tx.hash, gasUsed: rc.gasUsed.toString() };
}
