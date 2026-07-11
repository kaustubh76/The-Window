// Deterministic verification of the completeness backend (adminops + memberops +
// operator flow) against a live Anvil deploy. Drives a full epoch + both loan paths
// with explicit time/block control — no long-running services. Asserts each step.
import { handles, provider, ethers } from "../services/lib/chain.mjs";
import { ACTORS } from "../services/lib/actors.mjs";
import { ADMIN_PK, KEEPER_PK, OPERATOR_PK } from "../services/lib/roles.mjs";
import * as admin from "../services/lib/adminops.mjs";
import * as member from "../services/lib/memberops.mjs";

const log = (...a) => console.log("»", ...a);
const S = ["None", "Pending", "Active", "Repaid", "Defaulted"];

async function openBidClose() {
  const K = handles(KEEPER_PK);
  // open a fresh epoch
  await (await K.auction.openEpoch()).wait();
  const epoch = Number(await K.auction.currentEpoch());
  // crossing bids: lender1 ask 300 @4, borrower bid 300 @10 -> r*=4
  await member.submitBid("lender1", 0, 4, 300n);
  await member.submitBid("borrower", 1, 10, 300n);
  log(`epoch ${epoch}: encrypted bids submitted`);
  const epochLen = Number(await K.auction.epochLength());
  await provider.send("evm_increaseTime", [epochLen + 1]);
  await provider.send("evm_mine", []);
  await (await K.auction.closeEpoch()).wait();
  return epoch;
}

async function lifecycle(loanId, doRepay) {
  await member.lockByLoan(loanId);
  await (await handles(OPERATOR_PK).vault.confirmLock(loanId, ethers.id("op" + loanId))).wait();
  await admin.confirmFunding(ADMIN_PK, loanId);
  const st = Number(await handles(ADMIN_PK).book.loanState(loanId));
  if (st !== 2) throw new Error(`loan ${loanId} not Active (got ${S[st]})`);
  log(`loan ${loanId}: locked + funded (Active)`);
  if (doRepay) {
    await admin.repay(ADMIN_PK, loanId);
    const s = Number(await handles(ADMIN_PK).book.loanState(loanId));
    if (s !== 3) throw new Error(`loan ${loanId} not Repaid`);
    log(`loan ${loanId}: REPAID ✅`);
  }
}

async function main() {
  // --- repay path ---
  const e1 = await openBidClose();
  const p1 = await admin.printEpoch(ADMIN_PK, e1);
  if (!p1.trade) throw new Error("epoch 1 did not cross");
  log(`M-ONIA printed: epoch ${e1} r*=${p1.rStarBps} bps (real 37-tick PoCD)`);
  const loansA = await admin.matchEpoch(ADMIN_PK, e1);
  if (loansA.length === 0) throw new Error("no matches");
  log(`matched ${loansA.length} loan(s): ${loansA.join(",")}`);
  await lifecycle(loansA[0], true);
  if (process.env.REPAY_ONLY === "1") { log("\nBACKEND VERIFY (repay path): PASS ✅"); return; }

  // --- seize path (fresh epoch, fresh loan) ---
  const e2 = await openBidClose();
  const p2 = await admin.printEpoch(ADMIN_PK, e2);
  const loansB = await admin.matchEpoch(ADMIN_PK, e2);
  const idB = loansB[0];
  await lifecycle(idB, false); // fund, don't repay
  const tenor = Number(await handles(ADMIN_PK).book.tenorBlocks());
  await provider.send("anvil_mine", ["0x" + (tenor + 1).toString(16)]);
  await (await handles(KEEPER_PK).book.seize(idB)).wait();
  const sB = Number(await handles(ADMIN_PK).book.loanState(idB));
  if (sB !== 4) throw new Error(`loan ${idB} not Defaulted (got ${S[sB]})`);
  log(`loan ${idB}: deadline passed -> keeper SEIZED ✅`);

  log("\nBACKEND VERIFY: PASS — autonomous ops (print/match/lock/fund/repay/seize) all correct.");
}
main().then(() => process.exit(0)).catch((e) => { console.error("VERIFY FAIL:", e.message); process.exit(1); });
