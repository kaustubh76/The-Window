// Indexer — read-only. Rebuilds WINDOW state from chain events and serves a REST
// API shaped to the dashboard's frozen adapter types (dashboard/src/lib/adapter/types.ts).
// Re-derives everything from chain on boot + poll; a baked snapshot (services/indexer/snapshot.json,
// see scripts/gen_indexer_snapshot.mjs) seeds the log store so a cold boot resumes from near-head
// instead of re-scanning ~140k blocks (~7-10 min of blank market). Absent/stale snapshot → full
// backfill (crash-safe fallback). Logs are fetched INCREMENTALLY (append-only cursor): public RPCs
// cap getLogs ranges, and rescanning deploy->head every tick grows without bound on Fuji.
import express from "express";
import cors from "cors";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { provider, handles, queryAll, START_BLOCK, CHAIN_ID, ethers } from "../lib/chain.mjs";
import { buildFilters } from "./filters.mjs";
import { NO_TRADE, bps, cipher, decodeRatePrint, loanSizeCipher } from "./derive.mjs";

// Bind to Render's assigned $PORT when present (image-based Render services inject PORT and
// route to it) — falls back to INDEXER_PORT / 8787 for local + the driver container.
const PORT = Number(process.env.INDEXER_PORT || process.env.PORT || 8787);
const ASK = 0, BID = 1; // AuctionHouse.sol constants — not worth an RPC read

const BLOCK_SEC = Number(process.env.BLOCK_SEC || 2); // display estimate for deadlines
// Scripted-agent roster (comma-separated addresses) for the `simulated` disclosure flag.
// Addresses only — never actor keys (the read-only indexer must not hold PKs). Unset →
// fail-honest: flag EVERY member simulated rather than present a scripted actor as real.
const SIM_SET = new Set((process.env.SIM_ADDRS ?? "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean));
const isSim = (who) => (SIM_SET.size ? SIM_SET.has(who) : true);
const H = handles(); // no RPC — deployments JSON + ABIs from disk
const state = {
  epochs: new Map(), // epoch -> {status, openedAt, closesAt}
  prints: new Map(), // epoch -> MoniaPrint
  loans: [], // Loan[]
  members: [], // MemberInfo[]
  events: [], // recent WindowEvent-ish firehose
  bids: {}, // address -> MyBid[]
  tenorMs: 0,
  lastBlock: 0,
  clock: null, // rebuild-time snapshot; serves /epoch/clock without live RPC
};

// ---- incremental log store ---------------------------------------------------
// Events are append-only on every chain we run (Fuji/L1 finalize instantly; local
// chains are only ever reset together with this process), so each rebuild fetches
// just (cursor+1 .. head] per filter and appends. All filters commit together —
// a failed round is discarded whole, so `logs` never holds a mixed-height view.
const FILTERS = buildFilters(H);
const logs = Object.fromEntries(Object.keys(FILTERS).map((k) => [k, []]));
let cursor = START_BLOCK - 1;
// one-time-per-record caches (each record is immutable once written on-chain). printCache/sizeCache
// are declared HERE (not with aggCache below) so the snapshot seed can pre-fill them — those two are
// the per-record chain reads (getTransaction+prints, loans) that otherwise dominate a cold rebuild.
const printCache = new Map(); // epoch -> MoniaPrint (cached only once fully decoded)
const sizeCache = new Map(); // loanId -> cipher(cSize)

// Fast-resume seed: rehydrate the log store + the two hot per-record caches from a snapshot baked
// into the image, so the first rebuild scans only (snapshotCursor+1 .. head] AND skips the ~3.4k
// getTransaction/prints/loans reads — a ~7-min cold start becomes seconds. Faithful to what
// queryFilter/rebuild produce — parseLog rebuilds `.args`/`.fragment` from {topics,data} (the fields
// it drops are restored alongside); printCache/sizeCache values are baked via the SAME derive.mjs
// rebuild uses. Any problem (absent file, chain mismatch, decode error) falls back to a full backfill.
(function seedFromSnapshot() {
  const path = resolve(dirname(fileURLToPath(import.meta.url)), "snapshot.json");
  let snap;
  try {
    snap = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    console.log("[indexer] no snapshot — full backfill from START_BLOCK");
    return;
  }
  try {
    if (Number(snap.chainId) !== CHAIN_ID) {
      console.warn(`[indexer] snapshot chainId ${snap.chainId} != ${CHAIN_ID} — ignoring, full backfill`);
      return;
    }
    let n = 0;
    for (const key of Object.keys(FILTERS)) {
      const iface = FILTERS[key][0].interface;
      for (const l of snap.logs?.[key] || []) {
        const parsed = iface.parseLog({ topics: l.topics, data: l.data });
        if (!parsed) continue; // ABI drift — skip this one, rebuild tolerates missing events
        // Mirror an ethers v6 EventLog for exactly the fields rebuild() reads.
        logs[key].push({
          args: parsed.args,
          fragment: parsed.fragment,
          blockNumber: l.blockNumber,
          transactionHash: l.transactionHash,
          index: l.index,
        });
        n++;
      }
    }
    cursor = Number(snap.cursor);
    // Pre-fill the hot per-record caches so the first rebuild does zero getTransaction/prints/loans.
    for (const p of snap.prints || []) printCache.set(Number(p.epoch), p);
    for (const [id, cSize] of Object.entries(snap.sizes || {})) sizeCache.set(id, cSize);
    console.log(`[indexer] seeded ${n} events + ${printCache.size} prints + ${sizeCache.size} sizes @ block ${cursor} — delta backfill only`);
  } catch (e) {
    // Partial seed would leave a mixed-height store; reset to a clean full backfill instead.
    for (const key of Object.keys(FILTERS)) logs[key].length = 0;
    printCache.clear();
    sizeCache.clear();
    cursor = START_BLOCK - 1;
    console.warn(`[indexer] snapshot seed failed (${e?.message || e}) — full backfill`);
  }
})();

async function syncLogs(head) {
  if (head <= cursor) return;
  const keys = Object.keys(FILTERS);
  const fresh = {};
  for (let i = 0; i < keys.length; i += 4) { // bounded fan-out (public-RPC friendly)
    await Promise.all(keys.slice(i, i + 4).map(async (k) => {
      const [c, f] = FILTERS[k];
      fresh[k] = await queryAll(c, f, cursor + 1, head);
    }));
  }
  for (const k of keys) logs[k].push(...fresh[k]); // all-or-nothing commit
  cursor = head;
}

const aggCache = new Map(); // epoch -> /aggregates response (frozen once Printed)
let epochLen, tenorBlocks; // constructor immutables — read once

// Everything is built into locals and published to `state` in one synchronous
// block, so requests always see a complete snapshot (rebuilds never overlap:
// the loop only schedules the next one after the current one finishes).
async function rebuild() {
  epochLen ??= Number(await H.auction.epochLength());
  tenorBlocks ??= Number(await H.book.tenorBlocks());
  const tenorMs = tenorBlocks * BLOCK_SEC * 1000;
  const blk = await provider.getBlock("latest");
  const nowTs = Number(blk.timestamp);
  const curBlock = blk.number;
  await syncLogs(curBlock);
  const events = [];

  // epochs + clock — derived from Opened/Closed/Printed events (no per-epoch reads;
  // EpochPrinted covers no-trade prints too, via markPrinted)
  const closedSet = new Set(logs.epochClosed.map((e) => Number(e.args.epoch)));
  const printedSet = new Set(logs.epochPrinted.map((e) => Number(e.args.epoch)));
  const epochs = new Map();
  let cur = 0;
  for (const ev of logs.epochOpened) {
    const e = Number(ev.args.epoch);
    const start = Number(ev.args.startTs);
    cur = Math.max(cur, e);
    epochs.set(e, {
      epoch: e,
      status: printedSet.has(e) ? "Printed" : closedSet.has(e) ? "Closed" : "Open",
      openedAt: start * 1000,
      closesAt: (start + epochLen) * 1000,
      epochLenMs: epochLen * 1000,
    });
  }

  // prints (decode postPrint calldata for the depth curve — proven by the PoCD).
  // getTransaction + prints() run ONCE per epoch ever (immutable after the
  // AlreadyPrinted guard); a print whose tx the RPC hasn't indexed yet is left
  // uncached and decoded again next rebuild.
  const prints = new Map();
  for (const ev of logs.ratePrinted) {
    const epoch = Number(ev.args.epoch);
    let print = printCache.get(epoch);
    if (!print) {
      const { print: p, hasTx } = await decodeRatePrint(H, ev); // shared with the snapshot generator
      print = p;
      if (hasTx) printCache.set(epoch, print); // an un-indexed tx is left uncached and retried next rebuild
    }
    prints.set(epoch, print);
    events.push({ type: "RatePrinted", block: ev.blockNumber, txHash: ev.transactionHash, print });
  }
  // no-trade epochs (curve didn't cross)
  for (const ev of logs.noTrade) {
    const epoch = Number(ev.args.epoch);
    if (!prints.has(epoch)) {
      prints.set(epoch, { epoch, rStarBps: null, aggVolume: "0", depth: [], pocd: { verified: true }, printedAt: 0, stale: true });
    }
    events.push({ type: "NoTrade", block: ev.blockNumber, txHash: ev.transactionHash, epoch });
  }

  // epoch-boundary events (open/close) — more visible on-chain activity in the feed
  for (const [name, arr] of [["EpochOpened", logs.epochOpened], ["EpochClosed", logs.epochClosed]]) {
    for (const e of arr) {
      events.push({ type: name, block: e.blockNumber, txHash: e.transactionHash, epoch: Number(e.args.epoch ?? 0n) });
    }
  }

  // loans — every static field rides on LoanCreated; only the cSize ciphertext
  // needs a (memoized, once-per-loan) contract read. Status is derived from the
  // Funded/Repaid/Seized event sets. LoanCreated order == loanId order (ids are
  // assigned sequentially in postMatches), so loans[i].id === String(i).
  const fundedSet = new Set(logs.funded.map((e) => (e.args.loanId ?? 0n).toString()));
  const repaidSet = new Set(logs.repaid.map((e) => (e.args.loanId ?? 0n).toString()));
  const seizedSet = new Set(logs.bookSeized.map((e) => (e.args.loanId ?? 0n).toString()));
  // Collateral state, so the UI can advance the lifecycle after a lock: LockRequested (borrower's
  // lock lands instantly) OR Locked (operator-confirmed), minus Released/Seized. The frontend only
  // tests loan.collateral for truthiness, so a placeholder cipher is enough (real value stays hidden).
  const collReqSet = new Set(logs.vaultLockRequested.map((e) => (e.args.loanId ?? 0n).toString()));
  const collLockedSet = new Set(logs.vaultLocked.map((e) => (e.args.loanId ?? 0n).toString()));
  const collReleasedSet = new Set(logs.vaultReleased.map((e) => (e.args.loanId ?? 0n).toString()));
  const collSeizedSet = new Set(logs.vaultSeized.map((e) => (e.args.loanId ?? 0n).toString()));
  const COLL_PLACEHOLDER = { c1: ["0", "0"], c2: ["0", "0"] }; // truthy Ciphertext; amount is never revealed
  const loans = [];
  for (const e of logs.loanCreated) {
    const id = (e.args.loanId ?? 0n).toString();
    if (!sizeCache.has(id)) sizeCache.set(id, await loanSizeCipher(H, e.args.loanId)); // shared with the generator
    const deadlineBlock = Number(e.args.deadlineBlock);
    loans.push({
      id,
      epoch: Number(e.args.epoch),
      lender: e.args.lender.toLowerCase(),
      borrower: e.args.borrower.toLowerCase(),
      rateBps: bps(e.args.rateTick),
      size: sizeCache.get(id),
      collateral:
        (collReqSet.has(id) || collLockedSet.has(id)) && !collReleasedSet.has(id) && !collSeizedSet.has(id)
          ? COLL_PLACEHOLDER
          : undefined,
      deadlineBlock,
      deadlineAt: (nowTs + Math.max(0, deadlineBlock - curBlock) * BLOCK_SEC) * 1000,
      status: seizedSet.has(id) ? "Defaulted" : repaidSet.has(id) ? "Repaid" : fundedSet.has(id) ? "Active" : "Pending",
      createdTx: e.transactionHash,
    });
  }
  // loan-lifecycle + vault events for the firehose (epoch joined from the loan record)
  for (const [name, arr] of [
    ["LoanCreated", logs.loanCreated], ["Funded", logs.funded],
    ["Repaid", logs.repaid], ["Seized", logs.bookSeized],
  ]) {
    for (const e of arr) {
      const loanId = (e.args.loanId ?? 0n).toString();
      events.push({
        type: name, block: e.blockNumber, txHash: e.transactionHash, loanId,
        epoch: loans[Number(loanId)]?.epoch ?? 0,
      });
    }
  }
  for (const [name, arr] of [
    ["CollateralLocked", logs.vaultLocked], ["CollateralReleased", logs.vaultReleased],
    ["CollateralSeized", logs.vaultSeized],
  ]) {
    for (const e of arr) {
      events.push({ type: name, block: e.blockNumber, txHash: e.transactionHash, loanId: (e.args.loanId ?? 0n).toString() });
    }
  }

  // per-member bids (who + tick only; size stays ciphertext)
  const bids = {};
  const LOCKED = { c1: ["0", "1"], c2: ["0", "1"] };
  for (const [side, arr] of [["ask", logs.askSubmitted], ["bid", logs.bidSubmitted]]) {
    for (const e of arr) {
      const who = e.args.who.toLowerCase();
      (bids[who] ||= []).push({
        id: `${e.args.epoch}-${side}-${e.args.tick}-${e.blockNumber}`,
        epoch: Number(e.args.epoch), side, tick: Number(e.args.tick), bps: bps(e.args.tick),
        size: LOCKED, status: "submitted", txHash: e.transactionHash,
      });
      // also surface each bid in the global firehose (encrypted amount stays hidden)
      events.push({
        type: "BidSubmitted", block: e.blockNumber, txHash: e.transactionHash,
        epoch: Number(e.args.epoch), side, tick: Number(e.args.tick), who, simulated: isSim(who),
      });
    }
  }
  // members — the active flag replays Added/Removed in chain order (no isMember reads)
  const activeSet = new Set();
  for (const ev of [...logs.memberAdded, ...logs.memberRemoved]
    .sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index)) {
    const who = ev.args.who.toLowerCase();
    if (ev.fragment.name === "MemberAdded") activeSet.add(who);
    else activeSet.delete(who);
  }
  // Dedupe by address — a remove→re-add (e.g. the atomic-revoke demo) emits a second
  // MemberAdded; keyed insertion in chain order keeps one row per member (latest add wins).
  const memberMap = new Map();
  for (const ev of logs.memberAdded) {
    const who = ev.args.who.toLowerCase();
    memberMap.set(who, {
      address: who,
      simulated: isSim(who), // scripted agents only (all members when SIM_ADDRS is unset)
      active: activeSet.has(who),
      joinedEpoch: Number(ev.args.joinedEpoch),
      roles: ["public"],
    });
  }
  const members = [...memberMap.values()];

  // atomic publish — no awaits between these assignments
  state.epochs = epochs;
  state.prints = prints;
  state.loans = loans;
  state.members = members;
  state.bids = bids;
  state.events = events.sort((a, b) => a.block - b.block).slice(-200);
  state.tenorMs = tenorMs;
  state.lastBlock = curBlock;
  state.clock = { epoch: cur, chainNowMs: nowTs * 1000, wallMs: Date.now() };
}

const app = express();
app.use(cors());

// ---- READ_GATE: member-gated read surface (permissioned-L1 only) -------------
// eERC hides amounts; it does NOT hide participation — the open endpoints below
// (/members, /bids, /events) reveal WHO bid WHEN, which is the stigma leak eERC
// can't close on a public chain. On the sovereign L1, membership IS chain access,
// so the market's own read surface is member-gated too: a caller proves membership
// by signing a short-TTL challenge with a member EOA. Env-flagged (READ_GATE=1),
// so Fuji stays the open, honest hard-mode deployment (middleware is a no-op there).
// SCOPE: this gates the APPLICATION read surface (the actual market-observation
// channel). Node-level RPC restriction (validator-only) is the production posture.
const READ_GATE = process.env.READ_GATE === "1";
const CHALLENGE_TTL_S = 30; // buckets; the verifier accepts the current + previous
const memberCache = new Map(); // addr(lowercase) -> { ok, exp }
async function isMemberCached(addr) {
  const now = Date.now();
  const hit = memberCache.get(addr);
  if (hit && hit.exp > now) return hit.ok;
  let ok = false;
  try { ok = await H.registry.isMember(addr); } catch { ok = false; }
  memberCache.set(addr, { ok, exp: now + 10_000 }); // 10s TTL — not an RPC per request
  return ok;
}
// Challenge the client signs: `window-read:<floor(now/30s)>` (EIP-191 personal_sign).
export function readChallenge(nowMs = Date.now()) {
  return `window-read:${Math.floor(nowMs / (CHALLENGE_TTL_S * 1000))}`;
}
async function readGate(req, res, next) {
  if (!READ_GATE || req.path === "/health") return next();
  const sig = String(req.get("x-window-sig") || "");
  const claimed = String(req.get("x-window-address") || "").toLowerCase();
  if (!sig) return res.status(403).json({ error: "membership required: sign the read challenge (x-window-sig)" });
  const bucket = Math.floor(Date.now() / (CHALLENGE_TTL_S * 1000));
  let who = null;
  for (const b of [bucket, bucket - 1]) { // tolerate up to ~60s of skew / a bucket rollover
    try {
      const rec = ethers.verifyMessage(`window-read:${b}`, sig).toLowerCase();
      if (!claimed || claimed === rec) { who = rec; break; }
    } catch { /* try previous bucket */ }
  }
  if (!who) return res.status(403).json({ error: "bad or expired read signature" });
  if (!(await isMemberCached(who))) {
    return res.status(403).json({ error: "not a member — the L1 read surface is member-gated" });
  }
  next();
}
app.use(readGate);
if (READ_GATE) console.log("[indexer] READ_GATE on — member signature required for all reads except /health");

app.get("/health", (_req, res) => res.json({ ok: true, lastBlock: state.lastBlock }));

// Served from the rebuild snapshot (chain time extrapolated by wall clock since
// capture) — this endpoint is polled at 1s per browser and must not fan out to
// the RPC, nor hang when the RPC flakes.
app.get("/epoch/clock", (_req, res) => {
  const c = state.clock;
  const profile = process.env.PROFILE || "DEMO";
  if (!c) return res.json({ epoch: 0, status: "None", openedAt: 0, closesAt: 0, epochLenMs: 0, profile, tenorMs: 0, now: Date.now() });
  const e = state.epochs.get(c.epoch) || { epoch: c.epoch, status: "None", openedAt: 0, closesAt: 0, epochLenMs: 0 };
  res.json({ ...e, profile, tenorMs: state.tenorMs, now: c.chainNowMs + (Date.now() - c.wallMs) });
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
  try {
    if (aggCache.has(epoch)) return res.json(aggCache.get(epoch));
    const out = [];
    for (let lo = 0; lo < 37; lo += 8) { // bounded fan-out — 74 serial reads takes seconds on a public RPC
      const chunk = await Promise.all(
        Array.from({ length: Math.min(8, 37 - lo) }, (_, i) => lo + i).map(async (t) => {
          const [a, b] = await Promise.all([
            H.auction.getAggregate(epoch, ASK, t),
            H.auction.getAggregate(epoch, BID, t),
          ]);
          return [{ side: "ask", tick: t, agg: cipher(a.egct) }, { side: "bid", tick: t, agg: cipher(b.egct) }];
        }),
      );
      out.push(...chunk.flat());
    }
    if (state.epochs.get(epoch)?.status === "Printed") aggCache.set(epoch, out); // frozen after close
    res.json(out);
  } catch (e) {
    res.status(502).json({ error: e?.shortMessage || e?.message || String(e) });
  }
});

async function main() {
  // Listen FIRST: the port (and /health) stay up while the initial backfill runs —
  // on Fuji the first sync spans the whole deploy->head range, and boot must not
  // die on a transient RPC 500 either (handlers serve empty state until the first
  // rebuild publishes; the loop retries forever).
  app.listen(PORT, () => console.log(`indexer on :${PORT} (chain via ${provider._getConnection?.().url || "rpc"})`));
  let backfilled = false;
  const tick = async () => {
    const t0 = Date.now();
    try {
      await rebuild();
      const ms = Date.now() - t0;
      if (!backfilled) { console.log(`[indexer] backfill to block ${state.lastBlock} in ${ms}ms`); backfilled = true; }
      else if (ms > 3000) console.log(`[indexer] slow rebuild: ${ms}ms`); // slower than the cadence = worth a line
    } catch (e) {
      console.error("rebuild", e?.shortMessage || e?.message || e);
    }
    // self-scheduling: the next rebuild starts 3s AFTER the previous one finishes
    // (a fixed setInterval overlaps itself when a rebuild takes >3s)
    setTimeout(tick, 3000);
  };
  tick();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
