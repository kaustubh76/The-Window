// Reusable MEMBER operations (register / wrap / bid / lock / balance), performed
// server-side with the PROVEN packages/eerc-node flows for the disclosed simulated
// members. Same delegation posture as the admin ops. No unverified SDK, no browser proving.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { handles, deployments, provider, ethers } from "./chain.mjs";
import { ACTORS, AUDITOR } from "./actors.mjs";
import {
  userFromRaw, genRegistrationProof, processPoseidonEncryption, encryptMessage,
  genSolvencyProof, genWithdrawProof, decryptEGCT,
} from "../../packages/eerc-node/src/eerc.mjs";

const BUILD = resolve(dirname(fileURLToPath(import.meta.url)), "../../circuits/build");
const CHAIN_ID = Number(process.env.CHAIN_ID || 31337);

function egct(cipher) {
  return { c1: { x: cipher[0][0], y: cipher[0][1] }, c2: { x: cipher[1][0], y: cipher[1][1] } };
}

// TestUSDC faucet (public mint).
export async function faucet(actorName, amount) {
  const a = ACTORS[actorName];
  const H = handles(a.pk);
  await (await H.usdc.mint(a.address, BigInt(amount))).wait();
  return { minted: amount.toString() };
}

// Resolve the borrower of a loan and lock its collateral.
export async function lockByLoan(loanId, coll = 6000, loan = 5000) {
  const H = handles();
  const L = await H.book.loans(loanId);
  const a = Object.values(ACTORS).find((x) => x.address === L.borrower.toLowerCase());
  if (!a) throw new Error("loan borrower is not a known actor");
  return lockCollateral(a.name, loanId, coll, loan);
}

export async function registerMember(actorName) {
  const a = ACTORS[actorName];
  const H = handles(a.pk);
  if (await H.registrar.isUserRegistered(a.address)) return { already: true };
  const user = userFromRaw(a.bjjRaw);
  const p = await genRegistrationProof(user, a.address, CHAIN_ID);
  await (await H.registrar.register({ proofPoints: { a: p.a, b: p.b, c: p.c }, publicSignals: p.publicSignals })).wait();
  return { registered: true };
}

// Mint TestUSDC + approve + eERC deposit (converter wrap). Requires registered + auditor set.
export async function wrap(actorName, amount) {
  const a = ACTORS[actorName];
  const H = handles(a.pk);
  const d = deployments();
  const amt = BigInt(amount);
  await (await H.usdc.mint(a.address, amt)).wait();
  await (await H.usdc.approve(d.EERC_ADDR, amt)).wait();
  const user = userFromRaw(a.bjjRaw);
  const pct = processPoseidonEncryption([amt], user.publicKey);
  await (await H.eerc["deposit(uint256,address,uint256[7])"](amt, d.TESTUSDC_ADDR, [...pct.ciphertext, ...pct.authKey, pct.nonce])).wait();
  return { wrapped: amt.toString() };
}

// eERC withdraw (unwrap): burn encrypted balance back to TestUSDC. Uses the eERC
// withdraw circuit (proven) with the eERC auditor = the admin's registered key.
export async function unwrap(actorName, amount) {
  const a = ACTORS[actorName];
  const H = handles(a.pk);
  const user = userFromRaw(a.bjjRaw);
  const bal = await H.eerc.balanceOf(a.address, 1n);
  const flat = [bal.eGCT.c1.x, bal.eGCT.c1.y, bal.eGCT.c2.x, bal.eGCT.c2.y].map((x) => BigInt(x));
  const senderBalance = decryptEGCT(a.bjjRaw, { c1: { x: flat[0], y: flat[1] }, c2: { x: flat[2], y: flat[3] } }, 1 << 20);
  const eercAuditorPub = userFromRaw(ACTORS.admin.bjjRaw).publicKey; // eERC auditor = admin registered key
  const wp = await genWithdrawProof(user, BigInt(amount), senderBalance, flat, eercAuditorPub);
  await (await H.eerc.withdraw(1n, { proofPoints: { a: wp.a, b: wp.b, c: wp.c }, publicSignals: wp.publicSignals }, wp.balancePCT)).wait();
  return { unwrapped: BigInt(amount).toString() };
}

// Submit an encrypted bid (size hidden as an ElGamal EGCT to the auditor key).
export async function submitBid(actorName, side, tick, size) {
  const a = ACTORS[actorName];
  const H = handles(a.pk);
  const { cipher } = encryptMessage(AUDITOR.pub, BigInt(size));
  const c = egct(cipher);
  const tx = side === 0 ? await H.auction.submitAsk(tick, c, "0x") : await H.auction.submitBid(tick, c);
  await tx.wait();
  return { side, tick, submitted: true };
}

// Real ZK solvency proof (coll >= 1.2*loan) + vault.lockCollateral.
export async function lockCollateral(actorName, loanId, coll = 6000, loan = 5000) {
  const a = ACTORS[actorName];
  const H = handles(a.pk);
  const sp = await genSolvencyProof(BUILD, a.bjjRaw, coll, loan);
  await (await H.vault.lockCollateral(loanId, sp.cColl, sp.cLoan, sp.ownerPub, sp.a, sp.b, sp.c)).wait();
  return { loanId, locked: true };
}

// Decrypt the member's own eERC balance (small demo amounts -> eGCT BSGS).
export async function balanceOf(actorName) {
  const a = ACTORS[actorName];
  const H = handles();
  const usdc = (await H.usdc.balanceOf(a.address)).toString();
  const registered = await H.registrar.isUserRegistered(a.address);
  let eercClear = null;
  let eercEncrypted = { c1: ["0", "1"], c2: ["0", "1"] };
  if (registered) {
    try {
      const bal = await H.eerc.balanceOf(a.address, 1n);
      const eGCT = { c1: { x: bal.eGCT.c1.x, y: bal.eGCT.c1.y }, c2: { x: bal.eGCT.c2.x, y: bal.eGCT.c2.y } };
      eercEncrypted = { c1: [eGCT.c1.x.toString(), eGCT.c1.y.toString()], c2: [eGCT.c2.x.toString(), eGCT.c2.y.toString()] };
      eercClear = decryptEGCT(a.bjjRaw, eGCT, 1 << 20).toString();
    } catch { /* balance not initialised */ }
  }
  return { usdc, registered, eercClear, eercEncrypted };
}
