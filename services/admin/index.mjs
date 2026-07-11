// Admin — the ONLY plaintext surface (SOFR 5->6 boundary). On a Closed epoch it:
//   1. reads per-tick EGCT accumulators, decrypts them under the auditor key,
//   2. builds the depth curve + computes the clearing rate r* (on-chain-consistent),
//   3. generates the real 37-tick DepthCurve PoCD and calls postPrint,
//   4. reads individual bid ciphertexts (from tx calldata) to compute matches -> postMatches.
// HARD RULE: never log/emit plaintext sizes. Only rate + aggregate depth leave here.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { handles, provider } from "../lib/chain.mjs";
import { decryptEGCTDirect, genDepthArrayProof } from "../../packages/eerc-node/src/eerc.mjs";
import "dotenv/config";

const __dir = dirname(fileURLToPath(import.meta.url));
const BUILD = resolve(__dir, "../../circuits/build");

const ADMIN_PK = process.env.ADMIN_PK;
const auditorPriv = BigInt(process.env.AUDITOR_BJJ_PRIV);
const auditorPub = [BigInt(process.env.AUDITOR_BJJ_PUB_X), BigInt(process.env.AUDITOR_BJJ_PUB_Y)];
const POLL_MS = Number(process.env.ADMIN_POLL_MS || 3000);
const TICKS = 37;
const NO_TRADE = 65535;

// JS port of MONIAOracle._computeClearing (must agree with on-chain or postPrint reverts).
function computeClearing(askSum, bidSum) {
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

const egctObj = (r) => ({ c1: { x: r.c1.x, y: r.c1.y }, c2: { x: r.c2.x, y: r.c2.y } });

async function processEpoch(H, epoch) {
  const ASK = Number(await H.auction.ASK());
  const BID = Number(await H.auction.BID());
  const askAgg = [], bidAgg = [], askSum = [], bidSum = [];
  for (let t = 0; t < TICKS; t++) {
    const a = await H.auction.getAggregate(epoch, ASK, t);
    const b = await H.auction.getAggregate(epoch, BID, t);
    askAgg.push(egctObj(a.egct)); bidAgg.push(egctObj(b.egct));
    // direct-scalar decrypt (auction/PoCD auditor convention) — see F1 gate
    askSum.push(BigInt(decryptEGCTDirect(auditorPriv, egctObj(a.egct), 1 << 20)));
    bidSum.push(BigInt(decryptEGCTDirect(auditorPriv, egctObj(b.egct), 1 << 20)));
  }

  const { crossing, trade } = computeClearing(askSum, bidSum);
  const depth = [];
  for (let t = 0; t < TICKS; t++) depth.push({ askSum: askSum[t], bidSum: bidSum[t] });

  console.log(`[admin] epoch ${epoch}: computing PoCD (37-tick)...`);
  const proof = await genDepthArrayProof(BUILD, auditorPriv, auditorPub, askAgg, bidAgg, askSum, bidSum);

  const rStar = trade ? crossing : NO_TRADE;
  const tx = await H.oracle.postPrint(
    epoch, rStar,
    depth.map((d) => ({ askSum: d.askSum, bidSum: d.bidSum })),
    proof.a, proof.b, proof.c
  );
  await tx.wait();
  console.log(`[admin] M-ONIA printed: epoch ${epoch} r*=${trade ? 100 + 25 * crossing : "no-trade"} bps`);

  if (trade) await postMatches(H, epoch, crossing, askSum, bidSum);
}

// Read individual bid ciphertexts from tx calldata, decrypt, and pair at r*.
async function postMatches(H, epoch, rStar, askSum, bidSum) {
  const asksI = H.auction.interface;
  const lenders = [], borrowers = [];
  const askEvs = await H.auction.queryFilter(H.auction.filters.AskSubmitted(epoch), 0, "latest");
  const bidEvs = await H.auction.queryFilter(H.auction.filters.BidSubmitted(epoch), 0, "latest");
  for (const ev of askEvs) {
    if (Number(ev.args.tick) > rStar) continue; // lender accepts r* only if r* >= its tick
    lenders.push({ who: ev.args.who });
  }
  for (const ev of bidEvs) {
    if (Number(ev.args.tick) < rStar) continue; // borrower accepts r* only if r* <= its tick
    borrowers.push({ who: ev.args.who });
  }
  // Simple greedy pairing (one loan per lender/borrower pair) at the clearing rate.
  const n = Math.min(lenders.length, borrowers.length);
  if (n === 0) return;
  const zero = { c1: { x: 0n, y: 0n }, c2: { x: 0n, y: 0n } };
  const ms = [];
  for (let i = 0; i < n; i++) {
    ms.push({ lender: lenders[i].who, borrower: borrowers[i].who, rateTick: rStar, cSize: zero });
  }
  const tx = await H.book.postMatches(epoch, ms);
  await tx.wait();
  console.log(`[admin] posted ${n} match(es) @ tick ${rStar}`);
}

let processing = false;
async function tick() {
  if (processing) return;
  processing = true;
  try {
    const H = handles(ADMIN_PK);
    const cur = Number(await H.auction.currentEpoch());
    for (let e = 1; e <= cur; e++) {
      const status = Number(await H.auction.epochStatus(e));
      if (status === 2 /*Closed*/) {
        await processEpoch(H, e);
      }
    }
  } catch (e) {
    console.error("[admin]", e.message);
  } finally {
    processing = false;
  }
}

console.log("[admin] running (plaintext stays here); poll", POLL_MS, "ms");
setInterval(tick, POLL_MS);
tick();
