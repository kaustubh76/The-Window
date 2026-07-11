// Indexer — read-only. Rebuilds WINDOW state from chain events and serves a REST
// API shaped to the dashboard's frozen adapter types (dashboard/src/lib/adapter/types.ts).
// Crash-safe: no persistence, re-derives everything from chain on boot + poll.
import express from "express";
import cors from "cors";
import { ethers } from "ethers";
import { provider, handles, queryAll } from "../lib/chain.mjs";

const PORT = Number(process.env.INDEXER_PORT || 8787);
const NO_TRADE = 65535;
const bps = (tick) => 100 + 25 * Number(tick);
const cipher = (egct) => ({
  c1: [egct.c1.x.toString(), egct.c1.y.toString()],
  c2: [egct.c2.x.toString(), egct.c2.y.toString()],
});

const BLOCK_SEC = Number(process.env.BLOCK_SEC || 2); // display estimate for deadlines
let H;
const state = {
  epochs: new Map(), // epoch -> {status, openedAt, closesAt}
  prints: new Map(), // epoch -> MoniaPrint
  loans: [], // Loan[]
  members: [], // MemberInfo[]
  events: [], // recent WindowEvent-ish firehose
  bids: {}, // address -> MyBid[]
  tenorMs: 0,
  lastBlock: 0,
};

const LOAN_STATUS = ["None", "Pending", "Active", "Repaid", "Defaulted"];

async function rebuild() {
  H = handles();
  const oracleI = H.oracle.interface;
  const epochLen = Number(await H.auction.epochLength());
  const tenorBlocks = Number(await H.book.tenorBlocks());
  state.tenorMs = tenorBlocks * BLOCK_SEC * 1000;
  const blk = await provider.getBlock("latest");
  const nowTs = Number(blk.timestamp);
  const curBlock = blk.number;
  const cur = Number(await H.auction.currentEpoch());
  const events = [];

  // epochs + clock
  state.epochs.clear();
  for (let e = 1; e <= cur; e++) {
    const status = Number(await H.auction.epochStatus(e));
    const start = Number(await H.auction.epochStart(e));
    state.epochs.set(e, {
      epoch: e,
      status: ["None", "Open", "Closed", "Printed"][status],
      openedAt: start * 1000,
      closesAt: (start + epochLen) * 1000,
      epochLenMs: epochLen * 1000,
    });
  }

  // prints (decode postPrint calldata for the depth curve — proven by the PoCD)
  state.prints.clear();
  const printed = await queryAll(H.oracle, H.oracle.filters.RatePrinted());
  for (const ev of printed) {
    const epoch = Number(ev.args.epoch);
    const rTick = Number(ev.args.rStarTick);
    const tx = await provider.getTransaction(ev.transactionHash);
    let depth = [];
    try {
      const parsed = oracleI.parseTransaction({ data: tx.data });
      const d = parsed.args.depth; // (askSum,bidSum)[]
      depth = d.map((p, tick) => ({
        tick,
        bps: bps(tick),
        supply: p.askSum.toString(),
        demand: p.bidSum.toString(),
      }));
    } catch { /* attested / non-decodable */ }
    const pr = await H.oracle.prints(epoch);
    const print = {
      epoch,
      rStarBps: rTick === NO_TRADE ? null : bps(rTick),
      aggVolume: pr.aggVolume.toString(),
      depth,
      pocd: { verified: true, txHash: ev.transactionHash },
      printedAt: Number(pr.printedAt) * 1000,
      stale: false,
    };
    state.prints.set(epoch, print);
    events.push({ type: "RatePrinted", block: ev.blockNumber, print });
  }
  // no-trade epochs (curve didn't cross)
  for (const ev of await queryAll(H.oracle, H.oracle.filters.NoTrade())) {
    const epoch = Number(ev.args.epoch);
    if (!state.prints.has(epoch)) {
      state.prints.set(epoch, { epoch, rStarBps: null, aggVolume: "0", depth: [], pocd: { verified: true }, printedAt: 0, stale: true });
    }
    events.push({ type: "NoTrade", block: ev.blockNumber, epoch });
  }

  // loans
  state.loans = [];
  const nextId = Number(await H.book.nextLoanId());
  for (let id = 0; id < nextId; id++) {
    const L = await H.book.loans(id);
    const deadlineBlock = Number(L.deadlineBlock);
    state.loans.push({
      id: String(id),
      epoch: Number(L.epoch),
      lender: L.lender.toLowerCase(),
      borrower: L.borrower.toLowerCase(),
      rateBps: bps(L.rateTick),
      size: cipher(L.cSize),
      deadlineBlock,
      deadlineAt: (nowTs + Math.max(0, deadlineBlock - curBlock) * BLOCK_SEC) * 1000,
      status: LOAN_STATUS[Number(L.state)],
    });
  }
  // loan-lifecycle + vault events for the firehose
  for (const [name, ev] of [
    ["LoanCreated", H.book.filters.LoanCreated()], ["Funded", H.book.filters.Funded()],
    ["Repaid", H.book.filters.Repaid()], ["Seized", H.book.filters.Seized()],
  ]) {
    for (const e of await queryAll(H.book, ev)) {
      events.push({ type: name, block: e.blockNumber, loanId: (e.args.loanId ?? 0n).toString() });
    }
  }
  for (const [name, ev] of [
    ["CollateralLocked", H.vault.filters.Locked()], ["CollateralReleased", H.vault.filters.Released()],
    ["CollateralSeized", H.vault.filters.Seized()],
  ]) {
    for (const e of await queryAll(H.vault, ev)) {
      events.push({ type: name, block: e.blockNumber, loanId: (e.args.loanId ?? 0n).toString() });
    }
  }
  state.events = events.sort((a, b) => a.block - b.block).slice(-200);

  // per-member bids (who + tick only; size stays ciphertext)
  const bids = {};
  const LOCKED = { c1: ["0", "1"], c2: ["0", "1"] };
  for (const [side, ev] of [["ask", H.auction.filters.AskSubmitted()], ["bid", H.auction.filters.BidSubmitted()]]) {
    for (const e of await queryAll(H.auction, ev)) {
      const who = e.args.who.toLowerCase();
      (bids[who] ||= []).push({
        id: `${e.args.epoch}-${side}-${e.args.tick}-${e.blockNumber}`,
        epoch: Number(e.args.epoch), side, tick: Number(e.args.tick), bps: bps(e.args.tick),
        size: LOCKED, status: "submitted",
      });
    }
  }
  state.bids = bids;

  // members (from MemberAdded events)
  const added = await queryAll(H.registry, H.registry.filters.MemberAdded());
  state.members = [];
  for (const ev of added) {
    const who = ev.args.who.toLowerCase();
    const active = await H.registry.isMember(who);
    state.members.push({
      address: who,
      simulated: true, // all demo members are simulated
      active,
      joinedEpoch: Number(ev.args.joinedEpoch),
      roles: ["public"],
    });
  }

  state.lastBlock = await provider.getBlockNumber();
}

const app = express();
app.use(cors());

app.get("/health", (_req, res) => res.json({ ok: true, lastBlock: state.lastBlock }));

app.get("/epoch/clock", async (_req, res) => {
  const cur = Number(await H.auction.currentEpoch());
  const e = state.epochs.get(cur) || { epoch: cur, status: "None", openedAt: 0, closesAt: 0, epochLenMs: 0 };
  const blk = await provider.getBlock("latest");
  res.json({ ...e, profile: process.env.PROFILE || "DEMO", tenorMs: state.tenorMs, now: Number(blk.timestamp) * 1000 });
});

app.get("/events", (req, res) => {
  const since = Number(req.query.since || 0);
  res.json(state.events.filter((e) => e.block >= since));
});

app.get("/bids", (req, res) => {
  const a = String(req.query.address || "").toLowerCase();
  res.json((state.bids && state.bids[a]) || []);
});

// Endpoint paths match dashboard/src/services/indexer.ts (IndexerAPI).
app.get("/monia/latest", (_req, res) => {
  const epochs = [...state.prints.keys()].sort((a, b) => b - a);
  res.json(epochs.length ? state.prints.get(epochs[0]) : null);
});

app.get("/monia/history", (req, res) => {
  const limit = Number(req.query.limit || 40);
  const all = [...state.prints.values()].sort((a, b) => a.epoch - b.epoch);
  res.json(all.slice(-limit));
});

app.get("/depth", (req, res) => {
  const epoch = req.query.epoch != null
    ? Number(req.query.epoch)
    : Math.max(0, ...state.prints.keys());
  const pr = state.prints.get(epoch);
  res.json(pr ? pr.depth : []);
});

app.get("/loans", (_req, res) => res.json(state.loans));
app.get("/members", (_req, res) => res.json(state.members));

// raw aggregate ciphertexts per side/tick for the explorer split-screen (no plaintext)
app.get("/aggregates/:epoch", async (req, res) => {
  const epoch = Number(req.params.epoch);
  const out = [];
  const ASK = Number(await H.auction.ASK());
  const BID = Number(await H.auction.BID());
  for (let t = 0; t < 37; t++) {
    const a = await H.auction.getAggregate(epoch, ASK, t);
    const b = await H.auction.getAggregate(epoch, BID, t);
    out.push({ side: "ask", tick: t, agg: cipher(a.egct) });
    out.push({ side: "bid", tick: t, agg: cipher(b.egct) });
  }
  res.json(out);
});

async function main() {
  await rebuild();
  setInterval(() => rebuild().catch((e) => console.error("rebuild", e.message)), 3000);
  app.listen(PORT, () => console.log(`indexer on :${PORT} (chain via ${provider._getConnection?.().url || "rpc"})`));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
