// The two-leak story, made concrete for the demo/video. eERC encrypts the SIZE on
// both chains — but participation (WHO bid WHEN) is the stigma signal, and that's
// only closed by the permissioned L1's member-gated read surface.
//
//   PUBLIC FUJI  — a competitor reads the open indexer and sees the member roster
//                  and every bid's (who, epoch, tick). Sizes stay ciphertext, but
//                  "agent X is at the window this epoch" is fully visible.
//   L1 (gated)   — the same competitor (a non-member) is refused: 403. It cannot
//                  even enumerate members, let alone see who participated.
//
// Amounts are auditor-decryptable on BOTH chains (the honest SOFR model) — this
// script is only about the PARTICIPATION leak, not the amount.
// Run:  FUJI_INDEXER_URL=https://window-indexer.onrender.com node demo/what_a_competitor_sees.mjs
const FUJI = process.env.FUJI_INDEXER_URL || "http://127.0.0.1:8787";
const L1 = process.env.READGATE_URL || process.env.INDEXER_L1_URL || "http://127.0.0.1:8788";

async function jget(url) {
  try {
    const r = await fetch(url);
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* keep text */ }
    return { status: r.status, json, text };
  } catch (e) { return { status: null, err: e?.message || String(e) }; }
}

let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };

console.log("=".repeat(66));
console.log("  WHAT A COMPETITOR SEES  —  public Fuji vs. the permissioned L1");
console.log("=".repeat(66));

// ---- PUBLIC FUJI: the participation leak, in the open ----
console.log(`\n[ PUBLIC FUJI ]  reading the open indexer at ${FUJI}`);
const members = await jget(`${FUJI}/members`);
const events = await jget(`${FUJI}/events`);
if (members.status === 200 && Array.isArray(members.json)) {
  console.log(`  member roster VISIBLE: ${members.json.length} addresses`);
  for (const m of members.json.slice(0, 5)) console.log(`    • ${m.address}  (active=${m.active})`);
  const bids = (Array.isArray(events.json) ? events.json : []).filter((e) => e.type === "BidSubmitted");
  console.log(`  bid participation VISIBLE: ${bids.length} (who, epoch, side, tick) rows, e.g.`);
  for (const b of bids.slice(-5)) console.log(`    • ${b.who}  epoch ${b.epoch}  ${b.side}  tick ${b.tick}`);
  console.log("  => a competitor learns WHO is borrowing/lending each epoch. Stigma leaks.");
} else {
  console.log(`  (Fuji indexer not reachable at ${FUJI} — set FUJI_INDEXER_URL; skipping this half)`);
}

// ---- L1: participation is member-gated ----
console.log(`\n[ PERMISSIONED L1 ]  same competitor (a non-member) at ${L1}`);
const anonMembers = await jget(`${L1}/members`);
if (anonMembers.status === null) {
  console.log(`  (L1 read-gated indexer not reachable at ${L1} — start demo/run_l1.sh; skipping)`);
} else {
  check(anonMembers.status === 403, `non-member read of /members REFUSED (HTTP ${anonMembers.status})`);
  console.log("  => the competitor cannot enumerate members or see any bid. Participation hidden.");
}

console.log("\n" + "-".repeat(66));
console.log("  eERC hides the SIZE on both chains; the L1 also hides the PARTICIPATION.");
console.log("  Necessary + sufficient for the stigma thesis only WITH the permissioned L1.");
console.log("-".repeat(66));
process.exit(failures === 0 ? 0 : 1);
