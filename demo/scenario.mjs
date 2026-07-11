// F3 — deterministic full-epoch demo against the live Anvil stack, REAL proofs.
//   epoch 1: agents bid -> close -> admin prints M-ONIA (real 37-tick PoCD) ->
//            match -> borrower locks (real solvency proof) -> fund -> repay.
//   epoch 2: same up to fund, then advance past the deadline block -> seize.
// "The rate is public. The borrowing never was."
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { handles, provider, ethers } from "../services/lib/chain.mjs";
import {
  encryptMessage, decryptEGCTDirect, genDepthArrayProof, genSolvencyProof,
} from "../packages/eerc-node/src/eerc.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const BUILD = resolve(__dir, "../circuits/build");

// auditor scalar S (direct) — pub must equal the deployed AUDITOR_PUB.
const S = BigInt(process.env.AUDITOR_BJJ_PRIV || "2748579834902348905823409582340958234");
const auditorPub = [
  BigInt(process.env.AUDITOR_BJJ_PUB_X || "15126131017275559229883198140197230023892265818363501039953620538039205717764"),
  BigInt(process.env.AUDITOR_BJJ_PUB_Y || "7504911034826791718448377250227968384413910115391011404817860837847273794444"),
];
const BORROWER_BJJ = 111222333444555666777888999n; // borrower's own key for solvency proofs

const K = {
  admin: process.env.ADMIN_PK || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  keeper: process.env.KEEPER_PK || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  operator: process.env.VAULT_OPERATOR_PK || "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  lender1: process.env.LENDER1_PK || "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  lender2: process.env.LENDER2_PK || "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  borrower: process.env.BORROWER_PK || "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
};
const H = Object.fromEntries(Object.entries(K).map(([k, pk]) => [k, handles(pk)]));
const addrOf = (pk) => new ethers.Wallet(pk).address;
const TICKS = 37;
const egctIn = (size) => {
  const { cipher } = encryptMessage(auditorPub, BigInt(size));
  return { c1: { x: cipher[0][0], y: cipher[0][1] }, c2: { x: cipher[1][0], y: cipher[1][1] } };
};
const egctObj = (r) => ({ c1: { x: r.c1.x, y: r.c1.y }, c2: { x: r.c2.x, y: r.c2.y } });
const log = (...a) => console.log("»", ...a);

async function advanceAndClose() {
  await provider.send("evm_increaseTime", [61]);
  await provider.send("evm_mine", []);
  await (await H.keeper.auction.closeEpoch()).wait();
}

async function adminPrint(epoch) {
  const ASK = Number(await H.admin.auction.ASK());
  const BID = Number(await H.admin.auction.BID());
  const askAgg = [], bidAgg = [], askSum = [], bidSum = [], depth = [];
  for (let t = 0; t < TICKS; t++) {
    const a = await H.admin.auction.getAggregate(epoch, ASK, t);
    const b = await H.admin.auction.getAggregate(epoch, BID, t);
    askAgg.push(egctObj(a.egct)); bidAgg.push(egctObj(b.egct));
    const as = BigInt(decryptEGCTDirect(S, egctObj(a.egct), 1 << 18));
    const bs = BigInt(decryptEGCTDirect(S, egctObj(b.egct), 1 << 18));
    askSum.push(as); bidSum.push(bs);
    depth.push({ askSum: as, bidSum: bs });
  }
  // clearing (mirror on-chain _computeClearing)
  let demandFrom = bidSum.reduce((x, y) => x + y, 0n), cum = 0n, rStar = 65535;
  for (let t = 0; t < TICKS; t++) { cum += askSum[t]; if (cum > 0n && demandFrom > 0n && cum >= demandFrom) { rStar = t; break; } demandFrom -= bidSum[t]; }
  log(`epoch ${epoch}: proving 37-tick PoCD (~40s, always live)…`);
  const t0 = Date.now();
  const proof = await genDepthArrayProof(BUILD, S, auditorPub, askAgg, bidAgg, askSum, bidSum);
  log(`PoCD generated in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await (await H.admin.oracle.postPrint(epoch, rStar, depth.map((d) => ({ askSum: d.askSum, bidSum: d.bidSum })), proof.a, proof.b, proof.c)).wait();
  log(`★ M-ONIA printed: epoch ${epoch}  r* = ${rStar === 65535 ? "no-trade" : (100 + 25 * rStar) + " bps"}`);
  return rStar;
}

async function match(epoch, rStar, lenderKey) {
  const zero = { c1: { x: 0n, y: 0n }, c2: { x: 0n, y: 0n } };
  const id = Number(await H.admin.book.nextLoanId());
  await (await H.admin.book.postMatches(epoch, [{ lender: addrOf(lenderKey), borrower: addrOf(K.borrower), rateTick: rStar, cSize: zero }])).wait();
  log(`matched loan ${id}: ${addrOf(lenderKey).slice(0, 8)} → ${addrOf(K.borrower).slice(0, 8)} @ ${100 + 25 * rStar} bps`);
  return id;
}

async function lockAndFund(loanId) {
  log(`loan ${loanId}: proving collateral solvency (6000 ≥ 1.2×5000)…`);
  const sp = await genSolvencyProof(BUILD, BORROWER_BJJ, 6000, 5000);
  await (await H.borrower.vault.lockCollateral(loanId, sp.cColl, sp.cLoan, sp.ownerPub, sp.a, sp.b, sp.c)).wait();
  await (await H.operator.vault.confirmLock(loanId, ethers.id("ref" + loanId))).wait();
  await (await H.admin.book.confirmFunding(loanId, ethers.ZeroHash)).wait();
  log(`loan ${loanId}: collateral locked + funded (Active)`);
}

async function main() {
  log("THE WINDOW — live demo (real proofs). The rate is public. The borrowing never was.\n");

  // ---- Epoch 1: borrow → M-ONIA → repay ----
  await (await H.keeper.auction.openEpoch()).wait();
  const e1 = Number(await H.keeper.auction.currentEpoch());
  await (await H.lender1.auction.submitAsk(4, egctIn(300), "0x")).wait();
  await (await H.borrower.auction.submitBid(10, egctIn(300))).wait();
  log(`epoch ${e1}: 2 simulated members bid (encrypted sizes)`);
  await advanceAndClose();
  const r1 = await adminPrint(e1);
  const loanA = await match(e1, r1, K.lender1);
  await lockAndFund(loanA);
  await (await H.admin.book.repay(loanA, ethers.ZeroHash)).wait();
  log(`loan ${loanA}: REPAID → collateral released ✅\n`);

  // ---- Epoch 2: borrow → default → seize ----
  await (await H.keeper.auction.openEpoch()).wait();
  const e2 = Number(await H.keeper.auction.currentEpoch());
  await (await H.lender2.auction.submitAsk(4, egctIn(300), "0x")).wait();
  await (await H.borrower.auction.submitBid(10, egctIn(300))).wait();
  log(`epoch ${e2}: 2 simulated members bid`);
  await advanceAndClose();
  const r2 = await adminPrint(e2);
  const loanB = await match(e2, r2, K.lender2);
  await lockAndFund(loanB);
  const tenor = Number(await H.admin.book.tenorBlocks());
  await provider.send("anvil_mine", ["0x" + (tenor + 1).toString(16)]);
  log(`loan ${loanB}: deadline block passed (${tenor + 1} blocks mined) — keeper seizing…`);
  await (await H.keeper.book.seize(loanB)).wait();
  log(`loan ${loanB}: SEIZED → collateral reassigned to lender ✅\n`);

  const [tickA] = [await H.admin.book.loanState(loanA)];
  log(`final: loan ${loanA} state=${["None","Pending","Active","Repaid","Defaulted"][Number(await H.admin.book.loanState(loanA))]}, loan ${loanB} state=${["None","Pending","Active","Repaid","Defaulted"][Number(await H.admin.book.loanState(loanB))]}`);
  log("demo complete. M-ONIA printed with real proofs; individual sizes never left ciphertext.");
}

main().catch((e) => { console.error(e); process.exit(1); });
