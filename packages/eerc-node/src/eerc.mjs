// eERC client helpers for Node — mirrors ava-labs/EncryptedERC conventions
// (test/user.ts, src/poseidon, src/jub) using the SAME libraries the protocol
// uses, so proofs/ciphertexts are accepted by the deployed contracts.
import { Base8, mulPointEscalar, addPoint, subOrder, Fr } from "@zk-kit/baby-jubjub";
import {
  formatPrivKeyForBabyJub,
  genPrivKey,
  genRandomBabyJubValue,
  poseidonEncrypt,
} from "maci-crypto";
import { poseidon3 } from "poseidon-lite";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as snarkjs from "snarkjs";

const __dir = dirname(fileURLToPath(import.meta.url));
// Prebuilt eERC circuit artifacts shipped in the submodule.
const EERC_CIRCOM = resolve(__dir, "../../../contracts/lib/EncryptedERC/circom/build");
export const ART = {
  registration: {
    wasm: `${EERC_CIRCOM}/registration/registration.wasm`,
    zkey: `${EERC_CIRCOM}/registration/circuit_final.zkey`,
  },
  withdraw: {
    wasm: `${EERC_CIRCOM}/withdraw/withdraw.wasm`,
    zkey: `${EERC_CIRCOM}/withdraw/circuit_final.zkey`,
  },
  transfer: {
    wasm: `${EERC_CIRCOM}/transfer/transfer.wasm`,
    zkey: `${EERC_CIRCOM}/transfer/transfer.zkey`,
  },
};

export const BASE_POINT_ORDER = subOrder;

// Array DepthCurve PoCD artifacts + proof generation (used by the admin service).
export const ARRAY_ART = {
  wasm: `${EERC_CIRCOM}/../depth_pocd_array_js/depth_pocd_array.wasm`, // resolved below
};

// Generate the 37-tick DepthCurve PoCD proof from ACTUAL on-chain aggregates.
// askAgg/bidAgg: arrays[37] of {c1:{x,y}, c2:{x,y}} (as read from getAggregate).
// askSum/bidSum: arrays[37] of bigint (decrypted per-tick sums).
export async function genDepthArrayProof(buildDir, auditorPriv, auditorPub, askAgg, bidAgg, askSum, bidSum) {
  const wasm = `${buildDir}/depth_pocd_array_js/depth_pocd_array.wasm`;
  const zkey = `${buildDir}/depth_array_final.zkey`;
  const s = (x) => BigInt(x).toString();
  const pt = (p) => [s(p.x), s(p.y)];
  const input = {
    auditorPub: [s(auditorPub[0]), s(auditorPub[1])],
    askC1: askAgg.map((a) => pt(a.c1)),
    askC2: askAgg.map((a) => pt(a.c2)),
    askSum: askSum.map(s),
    bidC1: bidAgg.map((b) => pt(b.c1)),
    bidC2: bidAgg.map((b) => pt(b.c2)),
    bidSum: bidSum.map(s),
    auditorPriv: s(auditorPriv),
  };
  const { proof, publicSignals } = await import("snarkjs").then((sj) =>
    sj.groth16.fullProve(input, wasm, zkey)
  );
  return formatProof(proof, publicSignals);
}

export function randomNonce() {
  return BigInt("0x" + randomBytes(16).toString("hex")) + 1n;
}

// A user = raw priv, formatted BJJ scalar, and public key point.
export function genUser() {
  const privateKey = genPrivKey();
  const formattedPrivateKey = formatPrivKeyForBabyJub(privateKey) % subOrder;
  const publicKey = mulPointEscalar(Base8, formattedPrivateKey).map((x) => BigInt(x));
  return { privateKey, formattedPrivateKey, publicKey };
}

// Deterministic eERC user from a raw scalar (so services can reconstruct an
// actor's BJJ key later, e.g. to decrypt their eERC balance).
export function userFromRaw(rawPriv) {
  const privateKey = BigInt(rawPriv);
  const formattedPrivateKey = formatPrivKeyForBabyJub(privateKey) % subOrder;
  const publicKey = mulPointEscalar(Base8, formattedPrivateKey).map((x) => BigInt(x));
  return { privateKey, formattedPrivateKey, publicKey };
}

export function registrationHash(chainId, formattedPrivateKey, eoaAddress) {
  return poseidon3([BigInt(chainId), formattedPrivateKey, BigInt(eoaAddress)]);
}

// El-Gamal encryption of a scalar message (c1 = r·G, c2 = m·G + r·pk).
export function encryptMessage(publicKey, message, random = genRandomBabyJubValue()) {
  let r = random;
  if (r >= subOrder) r = genRandomBabyJubValue() / 100n;
  const p = mulPointEscalar(Base8, message);
  const c1 = mulPointEscalar(Base8, r);
  const pky = mulPointEscalar(publicKey, r);
  const c2 = addPoint(p, pky);
  return { cipher: [c1.map(BigInt), c2.map(BigInt)], random: r };
}

export function decryptPoint(privateKey, c1, c2) {
  const pk = formatPrivKeyForBabyJub(privateKey);
  const c1x = mulPointEscalar(c1, pk);
  const inv = [Fr.e(c1x[0] * -1n), c1x[1]];
  return addPoint(c2, inv).map(BigInt);
}

// Poseidon-ciphertext (PCT) for owner/auditor — used by deposit & as amountPCT.
export function processPoseidonEncryption(inputs, publicKey) {
  const nonce = randomNonce();
  let encRandom = genRandomBabyJubValue();
  if (encRandom >= subOrder) encRandom = genRandomBabyJubValue() / 10n;
  const poseidonKey = mulPointEscalar(publicKey, encRandom);
  const authKey = mulPointEscalar(Base8, encRandom).map(BigInt);
  const ciphertext = poseidonEncrypt(inputs, poseidonKey, nonce).map(BigInt);
  return { ciphertext, nonce, encRandom, authKey };
}

// snarkjs proof -> Solidity ProofPoints (a,b,c) with correct G2 coordinate order.
export async function formatProof(proof, publicSignals) {
  const cd = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  const [a, b, c, pub] = JSON.parse("[" + cd + "]");
  return { a, b, c, publicSignals: pub };
}

// Decrypt an ElGamal balance point and recover the scalar via baby-step-giant-step.
export function bsgs(M, maxUnits = 1 << 22) {
  const n = BigInt(Math.ceil(Math.sqrt(maxUnits)));
  const table = new Map();
  let cur = [0n, 1n]; // identity
  for (let j = 0n; j < n; j++) {
    table.set(cur[0].toString() + "," + cur[1].toString(), j);
    cur = addPoint(cur, Base8);
  }
  const nG = mulPointEscalar(Base8, n);
  const negNG = [Fr.e(nG[0] * -1n), nG[1]];
  let gamma = M;
  for (let i = 0n; i < n; i++) {
    const hit = table.get(gamma[0].toString() + "," + gamma[1].toString());
    if (hit !== undefined) return i * n + hit;
    gamma = addPoint(gamma, negNG);
  }
  throw new Error("bsgs: not found within maxUnits");
}

// Decrypt an eGCT {c1:[x,y], c2:[x,y]} balance to a scalar.
// NOTE: applies formatPrivKeyForBabyJub — use for eERC balances (User convention).
export function decryptEGCT(privateKey, eGCT, maxUnits = 1 << 22) {
  const c1 = [BigInt(eGCT.c1.x), BigInt(eGCT.c1.y)];
  const c2 = [BigInt(eGCT.c2.x), BigInt(eGCT.c2.y)];
  const M = decryptPoint(privateKey, c1, c2);
  return bsgs(M, maxUnits);
}

// Decrypt with the scalar used DIRECTLY (no formatPrivKeyForBabyJub). This is the
// auction/PoCD auditor convention: agents encrypt bid sizes to pub = scalar·G via
// encryptMessage, and the DepthCurve circuit uses `scalar` directly as auditorPriv
// (see test/MONIAOracleArrayIntegration.t.sol). Recovers M = c2 - scalar·c1 then BSGS.
export function decryptEGCTDirect(scalar, eGCT, maxUnits = 1 << 22) {
  const c1 = [BigInt(eGCT.c1.x), BigInt(eGCT.c1.y)];
  const c2 = [BigInt(eGCT.c2.x), BigInt(eGCT.c2.y)];
  const s = BigInt(scalar) % subOrder;
  const sC1 = mulPointEscalar(c1, s);
  const neg = [Fr.e(sC1[0] * -1n), sC1[1]];
  const M = addPoint(c2, neg).map(BigInt);
  return bsgs(M, maxUnits);
}

// Full transfer proof — mirrors ava-labs/EncryptedERC test/helpers.ts privateTransfer.
// senderEncryptedBalance = on-chain eGCT as [c1x, c1y, c2x, c2y].
export async function genTransferProof(
  sender, senderBalance, receiverPublicKey, transferAmount, senderEncryptedBalance, auditorPublicKey
) {
  const senderNewBalance = senderBalance - transferAmount;
  const { cipher: encAmtSender } = encryptMessage(sender.publicKey, transferAmount);
  const { cipher: encAmtReceiver, random: encAmtReceiverRandom } = encryptMessage(receiverPublicKey, transferAmount);
  const rcv = processPoseidonEncryption([transferAmount], receiverPublicKey);
  const aud = processPoseidonEncryption([transferAmount], auditorPublicKey);
  const snd = processPoseidonEncryption([senderNewBalance], sender.publicKey);

  const input = {
    ValueToTransfer: transferAmount,
    SenderPrivateKey: sender.formattedPrivateKey,
    SenderPublicKey: sender.publicKey,
    SenderBalance: senderBalance,
    SenderBalanceC1: senderEncryptedBalance.slice(0, 2),
    SenderBalanceC2: senderEncryptedBalance.slice(2, 4),
    SenderVTTC1: encAmtSender[0],
    SenderVTTC2: encAmtSender[1],
    ReceiverPublicKey: receiverPublicKey,
    ReceiverVTTC1: encAmtReceiver[0],
    ReceiverVTTC2: encAmtReceiver[1],
    ReceiverVTTRandom: encAmtReceiverRandom,
    ReceiverPCT: rcv.ciphertext,
    ReceiverPCTAuthKey: rcv.authKey,
    ReceiverPCTNonce: rcv.nonce,
    ReceiverPCTRandom: rcv.encRandom,
    AuditorPublicKey: auditorPublicKey,
    AuditorPCT: aud.ciphertext,
    AuditorPCTAuthKey: aud.authKey,
    AuditorPCTNonce: aud.nonce,
    AuditorPCTRandom: aud.encRandom,
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, ART.transfer.wasm, ART.transfer.zkey);
  const fp = await formatProof(proof, publicSignals);
  return { ...fp, senderBalancePCT: [...snd.ciphertext, ...snd.authKey, snd.nonce] };
}

// CollateralSolvency proof: borrower proves coll*10000 >= loan*h (h=12000) without
// revealing amounts. Ciphertexts are encrypted to the owner's own key (direct scalar,
// matching the circuit's CheckPublicKey/ElGamalDecrypt). Returns {a,b,c} + the
// ciphertexts + ownerPub in the exact shapes CollateralVault.lockCollateral wants.
export async function genSolvencyProof(buildDir, ownerScalar, coll, loan) {
  const s = BigInt(ownerScalar) % subOrder;
  const ownerPub = mulPointEscalar(Base8, s).map(BigInt);
  const cc = encryptMessage(ownerPub, BigInt(coll), 1n);
  const cl = encryptMessage(ownerPub, BigInt(loan), 1n);
  const dec = (p) => [p[0].toString(), p[1].toString()];
  const input = {
    Ccoll_c1: dec(cc.cipher[0]), Ccoll_c2: dec(cc.cipher[1]),
    Cloan_c1: dec(cl.cipher[0]), Cloan_c2: dec(cl.cipher[1]),
    h: "12000",
    ownerPub: [ownerPub[0].toString(), ownerPub[1].toString()],
    ownerPriv: s.toString(),
    coll: BigInt(coll).toString(),
    loan: BigInt(loan).toString(),
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input, `${buildDir}/collateral_solvency_js/collateral_solvency.wasm`, `${buildDir}/solvency_final.zkey`
  );
  const fp = await formatProof(proof, publicSignals);
  const egct = (c) => ({ c1: { x: c[0][0], y: c[0][1] }, c2: { x: c[1][0], y: c[1][1] } });
  return {
    a: fp.a, b: fp.b, c: fp.c,
    cColl: egct(cc.cipher), cLoan: egct(cl.cipher),
    ownerPub: [ownerPub[0], ownerPub[1]],
  };
}

// eERC withdraw proof — mirrors ava-labs/EncryptedERC test/helpers.ts withdraw.
// senderEncryptedBalance = current on-chain eGCT as [c1x,c1y,c2x,c2y]; senderBalance
// = its plaintext; auditorPub = the eERC auditor's public key.
export async function genWithdrawProof(user, amount, senderBalance, senderEncryptedBalance, auditorPub) {
  const newBalance = BigInt(senderBalance) - BigInt(amount);
  const snd = processPoseidonEncryption([newBalance], user.publicKey);
  const aud = processPoseidonEncryption([BigInt(amount)], auditorPub);
  const input = {
    ValueToWithdraw: BigInt(amount),
    SenderPrivateKey: user.formattedPrivateKey,
    SenderPublicKey: user.publicKey,
    SenderBalance: BigInt(senderBalance),
    SenderBalanceC1: senderEncryptedBalance.slice(0, 2),
    SenderBalanceC2: senderEncryptedBalance.slice(2, 4),
    AuditorPublicKey: auditorPub,
    AuditorPCT: aud.ciphertext,
    AuditorPCTAuthKey: aud.authKey,
    AuditorPCTNonce: aud.nonce,
    AuditorPCTRandom: aud.encRandom,
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, ART.withdraw.wasm, ART.withdraw.zkey);
  const fp = await formatProof(proof, publicSignals);
  return { a: fp.a, b: fp.b, c: fp.c, publicSignals: fp.publicSignals, balancePCT: [...snd.ciphertext, ...snd.authKey, snd.nonce] };
}

export async function genRegistrationProof({ formattedPrivateKey, publicKey }, eoaAddress, chainId) {
  const rHash = registrationHash(chainId, formattedPrivateKey, eoaAddress);
  const input = {
    SenderPrivateKey: formattedPrivateKey,
    SenderPublicKey: publicKey,
    SenderAddress: BigInt(eoaAddress),
    ChainID: BigInt(chainId),
    RegistrationHash: rHash,
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input, ART.registration.wasm, ART.registration.zkey
  );
  return { ...(await formatProof(proof, publicSignals)), registrationHash: rHash };
}
