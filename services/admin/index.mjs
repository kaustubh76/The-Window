// Admin — autonomous auditor + loan-lifecycle orchestrator. The ONLY plaintext
// surface. On each Closed epoch it prints M-ONIA (real 37-tick PoCD), posts matches,
// then drives each loan: borrower locks collateral (real solvency proof) -> operator
// confirms -> admin funds (attested) -> repay-most / default-one (keeper seizes the
// defaulter). Makes the unattended stack cycle loans end-to-end. Never logs plaintext.
import { handles } from "../lib/chain.mjs";
import { actorByAddress } from "../lib/actors.mjs";
import { ADMIN_PK, OPERATOR_PK } from "../lib/roles.mjs";
import { printEpoch, matchEpoch, confirmFunding, repay } from "../lib/adminops.mjs";
import { lockCollateral } from "../lib/memberops.mjs";
import { ethers } from "ethers";
import "dotenv/config";

const POLL_MS = Number(process.env.ADMIN_POLL_MS || 4000);
const handled = new Set();

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
    await (await op.vault.confirmLock(id, ethers.id("ref" + id))).wait(); // operator escrow
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
    const cur = Number(await H.auction.currentEpoch());
    for (let e = 1; e <= cur; e++) {
      if (handled.has(e)) continue;
      if (Number(await H.auction.epochStatus(e)) === 2 /*Closed*/) {
        handled.add(e);
        await processEpoch(e).catch((err) => { handled.delete(e); throw err; });
      }
    }
  } catch (e) {
    console.error("[admin]", e.message);
  }
}

console.log("[admin] autonomous orchestrator running (plaintext stays here); poll", POLL_MS, "ms");
setInterval(tick, POLL_MS);
tick();
