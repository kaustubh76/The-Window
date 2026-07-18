// Reusable admin (auditor-key) operations — used by the autonomous admin loop AND
// the Control API. The ONLY plaintext surface. HARD RULE: never log plaintext sizes.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { handles, queryAll, waitTx } from "./chain.mjs";
import { AUDITOR } from "./actors.mjs";
import { decryptEGCTDirect, genDepthArrayProof } from "../../packages/eerc-node/src/eerc.mjs";

const BUILD = resolve(dirname(fileURLToPath(import.meta.url)), "../../circuits/build");
const TICKS = 37;
export const NO_TRADE = 65535;

// BSGS ceiling for the per-tick aggregate decrypt. These are WHOLE-USDC scalar sums (agents bid
// tens-to-hundreds; a tick sum is at most a handful of those), so 1<<18 (262,144 USDC/tick) is
// far above any real total. Keep it SMALL on purpose: this runs 74× per decrypt on the 0.1-CPU
// hosted control, and cost is √maxUnits per call — a large ceiling (2**31 → √≈46k) would block
// the event loop for seconds and fail Render's 5s health check → OOM/kill loop. (1<<18 → √=512.)
const DEPTH_BSGS_MAX = 1 << 18;

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

// Bounded-concurrency map: run `fn` over items with at most `limit` in flight. A full
// Promise.all of all 74 getAggregate calls overwhelms the public Fuji RPC (500s); a deep
// sequential await chain (the old code) starves the event loop for ~15-30s → Render's 5s health
// check fails → SIGKILL/crash loop. ~8 concurrent is the sweet spot: ~2-3s AND RPC-friendly.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
    }),
  );
  return out;
}

// Read + decrypt per-tick aggregates under the auditor key. Reads run with bounded concurrency
// (fast + RPC-safe + non-blocking); decryption (BSGS) is CPU-cheap because DEPTH_BSGS_MAX is small.
export async function decryptDepth(H, epoch) {
  const ASK = Number(await H.auction.ASK());
  const BID = Number(await H.auction.BID());
  const jobs = [];
  for (let t = 0; t < TICKS; t++) { jobs.push([ASK, t], [BID, t]); }
  // Decrypt each aggregate right after its read returns — this spreads the 74 BSGS decrypts
  // across the (async, yielding) RPC window instead of one CPU burst at the end, so the event
  // loop keeps serving /health throughout even on the throttled 0.1-CPU hosted instance.
  const results = await mapLimit(jobs, 8, async ([side, t]) => {
    const raw = egctObj((await H.auction.getAggregate(epoch, side, t)).egct);
    return { raw, sum: BigInt(decryptEGCTDirect(AUDITOR.priv, raw, DEPTH_BSGS_MAX)) };
  });
  const askAgg = [], bidAgg = [], askSum = [], bidSum = [];
  for (let t = 0; t < TICKS; t++) {
    askAgg.push(results[2 * t].raw); bidAgg.push(results[2 * t + 1].raw);
    askSum.push(results[2 * t].sum); bidSum.push(results[2 * t + 1].sum);
  }
  return { askAgg, bidAgg, askSum, bidSum };
}

// Decrypt per-tick aggregates from the indexer's /aggregates payload (ONE HTTP fetch of all 74
// ciphertexts) instead of 74 on-chain getAggregate round-trips — ~10× faster on the throttled
// hosted control. For the DISPLAY endpoints only (/admin/decrypt, /admin/clearing); the PRINT
// proof stays on-chain (its PoCD is bound to the on-chain accumulator). Yields periodically so
// /health stays responsive during the BSGS burst. rows: [{side:'ask'|'bid', tick, agg:{c1,c2}}].
export async function decryptAggsFromIndexer(rows) {
  const askSum = new Array(TICKS).fill(0n), bidSum = new Array(TICKS).fill(0n);
  const askAgg = new Array(TICKS), bidAgg = new Array(TICKS);
  let n = 0;
  for (const r of rows) {
    const t = Number(r.tick);
    if (!(t >= 0 && t < TICKS) || !r.agg) continue;
    const eg = { c1: { x: r.agg.c1[0], y: r.agg.c1[1] }, c2: { x: r.agg.c2[0], y: r.agg.c2[1] } };
    const sum = BigInt(decryptEGCTDirect(AUDITOR.priv, eg, DEPTH_BSGS_MAX));
    if (r.side === "ask") { askSum[t] = sum; askAgg[t] = eg; } else { bidSum[t] = sum; bidAgg[t] = eg; }
    if (++n % 6 === 0) await new Promise((res) => setImmediate(res)); // keep the event loop live
  }
  return { askSum, bidSum, askAgg, bidAgg };
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
  const { tx, rc } = await waitTx(
    H.oracle.postPrint(
      epoch, rStar,
      depth.map((d) => ({ askSum: d.askSum, bidSum: d.bidSum })),
      proofs.map((p) => ({ a: p.a, b: p.b, c: p.c }))
    ),
    { label: `postPrint e${epoch}`, timeoutMs: 120_000 }, // heavy tx (~4.4M gas); a dropped send must not hang the loop
  );
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
  await waitTx(H.book.postMatches(epoch, ms), { label: `postMatches e${epoch}` });
  return Array.from({ length: n }, (_, i) => firstId + i);
}

// Auditor-attested confirm/repay (LoanBook onlyAdmin).
export async function confirmFunding(adminPk, loanId) {
  const H = handles(adminPk);
  const { tx, rc } = await waitTx(H.book.confirmFunding(loanId, "0x" + "00".repeat(32)), { label: `confirmFunding ${loanId}` });
  return { funded: String(loanId), txHash: tx.hash, gasUsed: rc.gasUsed.toString() };
}
export async function repay(adminPk, loanId) {
  const H = handles(adminPk);
  const { tx, rc } = await waitTx(H.book.repay(loanId, "0x" + "00".repeat(32)), { label: `repay ${loanId}` });
  return { repaid: String(loanId), txHash: tx.hash, gasUsed: rc.gasUsed.toString() };
}
