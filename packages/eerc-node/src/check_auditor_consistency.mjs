// F1 gate: prove auditor-key consistency across encrypt / decrypt / circuit.
// 1. Agents encrypt bid sizes to pub = S·G (encryptMessage, direct scalar).
// 2. Homomorphic-add ciphertexts (the on-chain accumulator).
// 3. decryptEGCTDirect(S, sum) must equal Σ sizes.
// 4. genDepthArrayProof(S, pub, ...) must produce a proof that verifies off-chain.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Base8, mulPointEscalar, addPoint, subOrder } from "@zk-kit/baby-jubjub";
import * as snarkjs from "snarkjs";
import { encryptMessage, decryptEGCTDirect, genDepthArrayProof } from "./eerc.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const BUILD = resolve(__dir, "../../../circuits/build");

const S = 2748579834902348905823409582340958234n; // auditor scalar (direct)
const pub = mulPointEscalar(Base8, S % subOrder).map(BigInt);

// 1+2: two agents bid 120 and 230 at the same tick; accumulate homomorphically.
const e1 = encryptMessage(pub, 120n);
const e2 = encryptMessage(pub, 230n);
const c1sum = addPoint(e1.cipher[0], e2.cipher[0]).map(BigInt);
const c2sum = addPoint(e1.cipher[1], e2.cipher[1]).map(BigInt);
const agg = { c1: { x: c1sum[0], y: c1sum[1] }, c2: { x: c2sum[0], y: c2sum[1] } };

// 3: decrypt with the scalar directly
const recovered = decryptEGCTDirect(S, agg, 1 << 16);
if (recovered !== 350n) throw new Error(`decrypt mismatch: got ${recovered}, expected 350`);
console.log("decryptEGCTDirect(S, Enc(120)+Enc(230)) =", recovered.toString(), "OK");

// 4: build a 37-tick depth (this aggregate at tick 4 ask), prove all 4 chunks,
//    verify each off-chain against the 102-signal chunk vkey.
const ID = { c1: { x: 0n, y: 1n }, c2: { x: 0n, y: 1n } };
const askAgg = [], bidAgg = [], askSum = [], bidSum = [];
for (let t = 0; t < 37; t++) { askAgg.push(ID); bidAgg.push(ID); askSum.push(0n); bidSum.push(0n); }
askAgg[4] = agg; askSum[4] = 350n;

const { proofs } = await genDepthArrayProof(BUILD, S, pub, askAgg, bidAgg, askSum, bidSum);
// re-run fullProve per chunk to get raw proof/publicSignals for snarkjs.verify
const s = (x) => BigInt(x).toString();
const pt = (p) => [s(p.x), s(p.y)];
const padAgg = [...askAgg, ID, ID, ID], padBid = [...bidAgg, ID, ID, ID];
const padASum = [...askSum, 0n, 0n, 0n], padBSum = [...bidSum, 0n, 0n, 0n];
const vkey = JSON.parse(readFileSync(`${BUILD}/depth_array_vkey.json`, "utf8"));
let allOk = true;
for (let k = 0; k < 4; k++) {
  const lo = k * 10, hi = lo + 10;
  const input = {
    auditorPub: [s(pub[0]), s(pub[1])],
    askC1: padAgg.slice(lo, hi).map((a) => pt(a.c1)), askC2: padAgg.slice(lo, hi).map((a) => pt(a.c2)), askSum: padASum.slice(lo, hi).map(s),
    bidC1: padBid.slice(lo, hi).map((b) => pt(b.c1)), bidC2: padBid.slice(lo, hi).map((b) => pt(b.c2)), bidSum: padBSum.slice(lo, hi).map(s),
    auditorPriv: s(S),
  };
  const { proof: rawProof, publicSignals } = await snarkjs.groth16.fullProve(
    input, `${BUILD}/depth_pocd_array_js/depth_pocd_array.wasm`, `${BUILD}/depth_array_final.zkey`
  );
  const ok = await snarkjs.groth16.verify(vkey, publicSignals, rawProof);
  console.log(`chunk ${k} PoCD (auditor scalar S) verify:`, ok ? "OK ✅" : "FAILED ❌");
  allOk = allOk && ok;
}
console.log("formatted proofs[0].a[0]:", proofs[0].a[0].slice(0, 12), "...");
process.exit(allOk && recovered === 350n ? 0 : 1);
