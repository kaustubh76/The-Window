// Keeper — stateless, crash-safe. Opens/closes epochs on schedule and seizes
// defaulted loans past their deadline block. Re-derives all state from chain;
// relies on contract reverts for idempotency (double-fire is safe).
import { provider, handles } from "../lib/chain.mjs";
import "dotenv/config";

const PK = process.env.KEEPER_PK;
if (!PK) throw new Error("KEEPER_PK required");
const POLL_MS = Number(process.env.KEEPER_POLL_MS || 3000);
const STALL_S = Number(process.env.KEEPER_STALL_S || 120); // reopen if an epoch stays Closed w/o a print

const H = handles(PK);
const S = ["None", "Open", "Closed", "Printed"];
const closedAt = {}; // epoch -> unix ts first seen Closed

async function tick() {
  const epochLen = Number(await H.auction.epochLength());
  const cur = Number(await H.auction.currentEpoch());
  const blk = await provider.getBlock("latest");
  const now = Number(blk.timestamp);

  const status = cur === 0 ? 0 : Number(await H.auction.epochStatus(cur));

  // open a new epoch if none open (previous printed/closed or none yet)
  if (cur === 0 || status !== 1 /*Open*/) {
    // liveness stall-guard: normally open once prev is Printed, but if it stays
    // Closed without a print past STALL_MS (admin down / print reverted), open anyway
    // so the loop never wedges.
    if (status === 2 /*Closed*/ && !closedAt[cur]) closedAt[cur] = now;
    const stalled = status === 2 && now - (closedAt[cur] || now) >= STALL_S;
    if (cur === 0 || status === 3 /*Printed*/ || stalled) {
      try {
        const tx = await H.auction.openEpoch();
        await tx.wait();
        console.log(`[keeper] opened epoch ${cur + 1}${stalled ? " (stall-guard: prev epoch never printed)" : ""}`);
      } catch (e) { /* someone else opened; ignore */ }
    }
  } else {
    // epoch is Open — close it once its window elapsed
    const start = Number(await H.auction.epochStart(cur));
    if (now >= start + epochLen) {
      try {
        const tx = await H.auction.closeEpoch();
        await tx.wait();
        console.log(`[keeper] closed epoch ${cur} (admin will print)`);
      } catch (e) { /* not elapsed / already closed */ }
    }
  }

  // seize defaulted loans past deadline
  const nextId = Number(await H.book.nextLoanId());
  const blockNum = await provider.getBlockNumber();
  for (let id = 0; id < nextId; id++) {
    const L = await H.book.loans(id);
    if (Number(L.state) === 2 /*Active*/ && blockNum > Number(L.deadlineBlock)) {
      try {
        const tx = await H.book.seize(id);
        await tx.wait();
        console.log(`[keeper] seized loan ${id} (deadline ${L.deadlineBlock} < ${blockNum})`);
      } catch (e) { /* already terminal */ }
    }
  }
}

console.log("[keeper] running; poll", POLL_MS, "ms");
setInterval(() => tick().catch((e) => console.error("[keeper]", e.message)), POLL_MS);
tick().catch((e) => console.error("[keeper]", e.message));
