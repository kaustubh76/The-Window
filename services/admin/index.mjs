// Admin — autonomous auditor + loan-lifecycle orchestrator. The ONLY plaintext
// surface. On each Closed epoch it prints M-ONIA (real 37-tick PoCD), posts matches,
// then drives each loan: borrower locks collateral (real solvency proof) -> operator
// confirms -> admin funds (attested) -> repay-most / default-one (keeper seizes the
// defaulter). Makes the unattended stack cycle loans end-to-end. Never logs plaintext.
import { handles, provider, waitTx } from "../lib/chain.mjs";
import { actorByAddress } from "../lib/actors.mjs";
import { ADMIN_PK, OPERATOR_PK } from "../lib/roles.mjs";
import { printEpoch, matchEpoch, confirmFunding, repay } from "../lib/adminops.mjs";
import { lockCollateral } from "../lib/memberops.mjs";
import { ethers } from "ethers";
import "dotenv/config";

const POLL_MS = Number(process.env.ADMIN_POLL_MS || 4000);
// How far behind the head to backfill missed prints. Each backlog epoch costs a
// full print (~4.4M gas + ~90s proving) — after a long driver outage an unbounded
// backfill would grind for days and drain the admin's gas on history nobody reads
// (the dashboard shows the recent window; older gaps read as stale epochs).
const BACKFILL = Number(process.env.ADMIN_BACKFILL_EPOCHS || 25);
// A broke/failing HEAD epoch must not starve the backlog: attempt up to this many Closed
// epochs per tick (newest first), stopping early on the first success so the headline stays
// fresh without over-proving. (Ascending order once wedged the admin for hours; newest-first
// alone still let a persistently-failing head monopolize every tick — this bounds that.)
const MAX_ATTEMPTS = Number(process.env.ADMIN_MAX_ATTEMPTS_PER_TICK || 3);
// Below this the admin can't pay for a print (~4.4M gas). Surface it LOUDLY — otherwise gas
// exhaustion looks identical to a healthy market (agents/keeper on other keys keep going) while
// r*/M-ONIA silently freezes. No auto-faucet: Fuji AVAX faucets are web/captcha; top up manually.
const LOW_GAS_WEI = ethers.parseEther(process.env.ADMIN_MIN_AVAX || "0.01");
const ADMIN_ADDR = new ethers.Wallet(ADMIN_PK).address;
const handled = new Set();
let gasTick = 0;

async function processEpoch(epoch) {
  const print = await printEpoch(ADMIN_PK, epoch);
  console.log(`[admin] M-ONIA epoch ${epoch}: r*=${print.rStarBps ?? "no-trade"} bps`);
  if (!print.trade) return;

  const loans = await matchEpoch(ADMIN_PK, epoch);
  console.log(`[admin] posted ${loans.length} match(es)`);
  const H = handles(ADMIN_PK);
  const op = handles(OPERATOR_PK);

  for (let i = 0; i < loans.length; i++) {
    const id = loans[i];
    const L = await H.book.loans(id);
    const borrower = actorByAddress(L.borrower);
    if (!borrower) { console.warn(`[admin] loan ${id}: unknown borrower ${L.borrower}`); continue; }
    await lockCollateral(borrower.name, id);                       // real solvency proof
    // operator escrow — the standalone operator service watches for Requested locks
    // and confirms them from the operator key. Two processes sending from that key
    // collide on nonces, so WAIT for the operator to confirm (single writer); only
    // if it never shows up (service not running) confirm ourselves as fallback.
    let lock = await H.vault.locks(id);
    for (let w = 0; w < 12 && Number(lock.state) === 1 /*Requested*/; w++) {
      await new Promise((r) => setTimeout(r, 5000));
      lock = await H.vault.locks(id);
    }
    if (Number(lock.state) === 1) {
      try { await waitTx(op.vault.confirmLock(id, ethers.id("ref" + id)), { label: `confirmLock ${id}`, timeoutMs: 60_000 }); } catch {}
      lock = await H.vault.locks(id);
    }
    if (Number(lock.state) !== 2 /*Locked*/) throw new Error(`loan ${id}: lock never confirmed`);
    console.log(`[admin] loan ${id}: escrow confirmed`);
    await confirmFunding(ADMIN_PK, id);                            // attested -> Active
    if (i < loans.length - 1) {
      await repay(ADMIN_PK, id);                                   // most repay -> released
      console.log(`[admin] loan ${id}: repaid`);
    } else {
      console.log(`[admin] loan ${id}: left to default (keeper will seize past deadline)`);
    }
  }
}

async function tick() {
  try {
    const H = handles(ADMIN_PK);
    // Gas self-check (~every 15 ticks): a drained admin key fails every print, but the market
    // still LOOKS live (keeper/agents sign with other keys) — make the real cause obvious in logs.
    if (gasTick++ % 15 === 0) {
      try {
        const bal = await provider.getBalance(ADMIN_ADDR);
        if (bal < LOW_GAS_WEI) console.warn(`[admin] LOW GAS ${ethers.formatEther(bal)} AVAX at ${ADMIN_ADDR} — prints will FAIL until funded (Fuji faucet)`);
      } catch { /* balance read is best-effort */ }
    }
    const cur = Number(await H.auction.currentEpoch());
    // NEWEST first: the headline M-ONIA print stays fresh while any backlog backfills behind it.
    // Attempt up to MAX_ATTEMPTS Closed epochs per tick, stopping on the first SUCCESS — so a
    // persistently-failing head (out of gas, dropped tx, RPC flake) can no longer monopolize
    // every tick and freeze all prints; the loop moves on to older pending epochs.
    let attempts = 0;
    for (let e = cur; e >= 1; e--) {
      if (handled.has(e)) continue;
      if (e < cur - BACKFILL) { handled.add(e); continue; } // beyond the backfill window — leave unprinted
      const status = Number(await H.auction.epochStatus(e));
      if (status === 3 /*Printed*/) { handled.add(e); continue; } // don't re-read forever
      if (status !== 2 /*Closed*/) continue; // Open/None — look at an older epoch
      handled.add(e);
      try {
        await processEpoch(e);
        break; // printed the newest reachable epoch — headline is fresh; yield the tick
      } catch (err) {
        handled.delete(e); // re-arm for a later retry
        console.error(`[admin] epoch ${e} failed: ${err.message}`);
        if (++attempts >= MAX_ATTEMPTS) break; // bounded work per tick — don't spin forever
      }
    }
  } catch (e) {
    console.error("[admin]", e.message);
  }
}

console.log("[admin] autonomous orchestrator running (plaintext stays here); poll", POLL_MS, "ms");
// self-scheduling (no overlap): processEpoch runs for minutes (proving + waits); the
// `handled` set already guards re-entry, but overlapped ticks still stack RPC reads.
const loop = () => setTimeout(async () => { await tick(); loop(); }, POLL_MS);
tick().then(loop);
