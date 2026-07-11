// Generate a valid witness input for the DepthCurve PoCD (single-sum) circuit.
// Builds two ElGamal ciphertexts encrypted to the auditor key, sums them
// homomorphically, and writes input.json + a sanity self-check (BSGS recovery).
import { writeFileSync } from "node:fs";
import { jub, keypair, encrypt, addCipher, decryptToPoint, bsgs, pointToDec } from "./elgamal.mjs";

const OUT = process.argv[2] || "../../circuits/build/pocd_input.json";

// Auditor private key (test scalar, < subOrder).
const auditorPriv = 2748579834902348905823409582340958234n;

// Two bid sizes to accumulate.
const m1 = 100n, m2 = 250n;
const r1 = 987654321n, r2 = 123456789n;

const j = await jub();
const { pub } = await keypair(auditorPriv);

const e1 = await encrypt(pub, m1, r1);
const e2 = await encrypt(pub, m2, r2);
const Csum = await addCipher(e1, e2);

// Self-check: decrypt the sum and recover the plaintext via BSGS.
const M = await decryptToPoint(auditorPriv, Csum);
const recovered = await bsgs(M, 1 << 20);
const claimedSum = m1 + m2;
if (BigInt(recovered) !== claimedSum) {
  throw new Error(`BSGS mismatch: got ${recovered}, expected ${claimedSum}`);
}

const c1 = pointToDec(j.F, Csum.c1);
const c2 = pointToDec(j.F, Csum.c2);
const pubDec = pointToDec(j.F, pub);

const input = {
  Csum_c1: c1,
  Csum_c2: c2,
  claimedSum: claimedSum.toString(),
  auditorPub: pubDec,
  auditorPriv: auditorPriv.toString(),
};

writeFileSync(OUT, JSON.stringify(input, null, 2));

// Public signals order matches `component main { public [...] }`:
// Csum_c1[2], Csum_c2[2], claimedSum, auditorPub[2]
console.log("OK: wrote", OUT);
console.log("BSGS recovered claimedSum =", recovered, "(expected", claimedSum.toString() + ")");
console.log("publicSignals =", JSON.stringify([...c1, ...c2, claimedSum.toString(), ...pubDec]));
