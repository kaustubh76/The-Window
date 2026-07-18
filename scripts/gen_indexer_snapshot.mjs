// Bakes a fast-resume snapshot for the indexer: fetches every event the indexer replays into state
// (up to one consistent head) AND pre-decodes the two per-record caches (prints, loan sizes) that
// otherwise dominate a cold rebuild. Writes services/indexer/snapshot.json; the image COPYs it in
// and services/indexer/index.mjs seeds its log store + caches from it, so a cold boot serves the
// real market in seconds instead of re-scanning ~140k blocks + ~3.4k reads (~7-10 min blank market).
//
// Run BEFORE `docker buildx build`, e.g.:
//   RPC_LOCAL=https://api.avax-test.network/ext/bc/C/rpc CHAIN_ID=43113 START_BLOCK=56937681 \
//     node scripts/gen_indexer_snapshot.mjs
// Regenerate right before judging so the delta is near-zero.
import { writeFileSync, mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { provider, handles, queryAll, START_BLOCK, CHAIN_ID } from "../services/lib/chain.mjs";
import { buildFilters, HIGH_VOLUME_KEYS } from "../services/indexer/filters.mjs";
import { decodeRatePrint, loanSizeCipher } from "../services/indexer/derive.mjs";

// Recent-window cap for the high-volume ask/bid filters. Old bids only affect /bids history for
// ancient epochs — never epochs/prints/loans/clock — so capturing the last ~N blocks keeps the
// snapshot small while structural events are captured in full. ~60 blocks/epoch on Fuji, so the
// default ~20k blocks ≈ last ~330 epochs of bids.
const SNAP_BID_BLOCKS = Number(process.env.SNAP_BID_BLOCKS || 20000);
const CONCURRENCY = Number(process.env.SNAP_CONCURRENCY || 8); // bounded fan-out for the decode reads

// Run `fn` over `items` with at most `limit` in flight (public-RPC friendly). Preserves order.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

async function main() {
  const H = handles(); // read-only (no signer)
  const FILTERS = buildFilters(H);
  const head = await provider.getBlockNumber();
  console.log(`[snapshot] chain ${CHAIN_ID}, head ${head}, START_BLOCK ${START_BLOCK}, span ${head - START_BLOCK} blocks`);

  const out = { chainId: CHAIN_ID, cursor: head, generatedAtBlock: head, logs: {}, prints: [], sizes: {} };
  const raw = {};
  let total = 0;
  for (const key of Object.keys(FILTERS)) {
    const [contract, filter] = FILTERS[key];
    const from = HIGH_VOLUME_KEYS.includes(key) ? Math.max(START_BLOCK, head - SNAP_BID_BLOCKS) : START_BLOCK;
    const events = await queryAll(contract, filter, from, head); // ascending, one consistent head
    raw[key] = events;
    // Store the minimal faithful shape: parseLog rebuilds .args/.fragment from {topics,data}; the
    // fields it drops (blockNumber/transactionHash/index) are what the indexer restores alongside.
    out.logs[key] = events.map((e) => ({
      topics: Array.from(e.topics),
      data: e.data,
      blockNumber: e.blockNumber,
      transactionHash: e.transactionHash,
      index: e.index,
    }));
    total += out.logs[key].length;
    console.log(`[snapshot] ${key.padEnd(14)} ${out.logs[key].length} events (from ${from})`);
  }

  // Pre-decode the two hot per-record caches via the SAME derive.mjs the indexer uses (no drift).
  console.log(`[snapshot] decoding ${raw.ratePrinted.length} prints + ${raw.loanCreated.length} loan sizes (concurrency ${CONCURRENCY})…`);
  const decoded = await mapLimit(raw.ratePrinted, CONCURRENCY, (ev) => decodeRatePrint(H, ev));
  out.prints = decoded.filter((d) => d.hasTx).map((d) => d.print); // skip any tx the RPC hasn't indexed
  const sizes = await mapLimit(raw.loanCreated, CONCURRENCY, async (ev) => [ev.args.loanId.toString(), await loanSizeCipher(H, ev.args.loanId)]);
  out.sizes = Object.fromEntries(sizes);

  const path = resolve(dirname(fileURLToPath(import.meta.url)), "../services/indexer/snapshot.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(out));
  const mb = (statSync(path).size / 1e6).toFixed(1);
  console.log(`[snapshot] wrote ${total} events + ${out.prints.length} prints + ${Object.keys(out.sizes).length} sizes, cursor ${head} -> ${path} (${mb} MB)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("[snapshot] FAILED:", e); process.exit(1); });
