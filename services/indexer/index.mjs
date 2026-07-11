// Indexer — read-only. Rebuilds WINDOW state from chain events and serves a REST
// API shaped to the dashboard's frozen adapter types (dashboard/src/lib/adapter/types.ts).
// Crash-safe: no persistence, re-derives everything from chain on boot + poll.
import express from "express";
import cors from "cors";
import { ethers } from "ethers";
import { provider, handles } from "../lib/chain.mjs";

const PORT = Number(process.env.INDEXER_PORT || 8787);
const NO_TRADE = 65535;
const bps = (tick) => 100 + 25 * Number(tick);
const cipher = (egct) => ({
  c1: [egct.c1.x.toString(), egct.c1.y.toString()],
  c2: [egct.c2.x.toString(), egct.c2.y.toString()],
});

let H;
const state = {
  epochs: new Map(), // epoch -> {status, openedAt, closesAt}
  prints: new Map(), // epoch -> MoniaPrint
  loans: [], // Loan[]
  members: [], // MemberInfo[]
  lastBlock: 0,
};

const LOAN_STATUS = ["None", "Pending", "Active", "Repaid", "Defaulted"];

async function rebuild() {
  H = handles();
  const oracleI = H.oracle.interface;
  const epochLen = Number(await H.auction.epochLength());
  const cur = Number(await H.auction.currentEpoch());

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
  const printed = await H.oracle.queryFilter(H.oracle.filters.RatePrinted(), 0, "latest");
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
    state.prints.set(epoch, {
      epoch,
      rStarBps: rTick === NO_TRADE ? null : bps(rTick),
      aggVolume: pr.aggVolume.toString(),
      depth,
      pocd: { verified: true, txHash: ev.transactionHash },
      printedAt: Number(pr.printedAt) * 1000,
      stale: false,
    });
  }

  // loans
  state.loans = [];
  const nextId = Number(await H.book.nextLoanId());
  for (let id = 0; id < nextId; id++) {
    const L = await H.book.loans(id);
    state.loans.push({
      id: String(id),
      epoch: Number(L.epoch),
      lender: L.lender.toLowerCase(),
      borrower: L.borrower.toLowerCase(),
      rateBps: bps(L.rateTick),
      size: cipher(L.cSize),
      deadlineBlock: Number(L.deadlineBlock),
      deadlineAt: 0,
      status: LOAN_STATUS[Number(L.state)],
    });
  }

  // members (from MemberAdded events)
  const added = await H.registry.queryFilter(H.registry.filters.MemberAdded(), 0, "latest");
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
  res.json({ ...e, profile: process.env.PROFILE || "DEMO", tenorMs: 0, now: Number(blk.timestamp) * 1000 });
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
