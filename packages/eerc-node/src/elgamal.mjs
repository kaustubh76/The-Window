// ElGamal-over-BabyJubJub helpers for THE WINDOW Node services.
//
// eERC's SDK is React-hooks only, so Node services (admin, keeper, agents) use
// these primitives directly. The curve (Base8, field, order) is circomlibjs'
// BabyJubJub, which matches the on-chain eERC BabyJubJub library and the circom
// components bit-for-bit.
import { buildBabyjub } from "circomlibjs";

let _jub = null;
export async function jub() {
  if (!_jub) _jub = await buildBabyjub();
  return _jub;
}

// Field element -> bigint (decimal-string friendly).
export function toBig(F, el) {
  return F.toObject(el);
}

// A point as [xBig, yBig] decimal-string pair for circom / Solidity.
export function pointToDec(F, P) {
  return [F.toObject(P[0]).toString(), F.toObject(P[1]).toString()];
}

// Derive a keypair. priv is a scalar < subOrder.
export async function keypair(priv) {
  const j = await jub();
  const pub = j.mulPointEscalar(j.Base8, priv);
  return { priv, pub };
}

// Encrypt a scalar message `m` to public key `pub` with randomness `r`.
// c1 = r·G ; c2 = m·G + r·pub   (additively homomorphic).
export async function encrypt(pub, m, r) {
  const j = await jub();
  const c1 = j.mulPointEscalar(j.Base8, r);
  const mG = j.mulPointEscalar(j.Base8, m);
  const rPub = j.mulPointEscalar(pub, r);
  const c2 = j.addPoint(mG, rPub);
  return { c1, c2 };
}

// Homomorphic sum of two ciphertexts: Enc(a)+Enc(b) = Enc(a+b).
export async function addCipher(A, B) {
  const j = await jub();
  return { c1: j.addPoint(A.c1, B.c1), c2: j.addPoint(A.c2, B.c2) };
}

// Decrypt to the message point M = c2 - priv·c1 = m·G.
export async function decryptToPoint(priv, C) {
  const j = await jub();
  const privC1 = j.mulPointEscalar(C.c1, priv);
  // negate: -(x,y) = (-x, y) on twisted Edwards
  const neg = [j.F.neg(privC1[0]), privC1[1]];
  return j.addPoint(C.c2, neg);
}

// Baby-step-giant-step: recover m from M = m·G, for m in [0, maxUnits).
export async function bsgs(M, maxUnits = 1 << 22) {
  const j = await jub();
  const n = Math.ceil(Math.sqrt(maxUnits));
  // baby steps: table of j*G -> j
  const table = new Map();
  let cur = [j.F.e(0), j.F.e(1)]; // identity (0,1)
  for (let jj = 0; jj < n; jj++) {
    table.set(j.F.toString(cur[0]) + "," + j.F.toString(cur[1]), jj);
    cur = j.addPoint(cur, j.Base8);
  }
  // giant step: M - i*n*G
  const nG = j.mulPointEscalar(j.Base8, n);
  const negNG = [j.F.neg(nG[0]), nG[1]];
  let gamma = M;
  for (let i = 0; i < n; i++) {
    const key = j.F.toString(gamma[0]) + "," + j.F.toString(gamma[1]);
    if (table.has(key)) return i * n + table.get(key);
    gamma = j.addPoint(gamma, negNG);
  }
  throw new Error("bsgs: message not found within maxUnits");
}
