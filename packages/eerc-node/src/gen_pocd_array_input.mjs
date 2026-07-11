// Generate witnesses for the CHUNKED DepthCurve array PoCD (K=4 chunks of 10 ticks).
// Scenario: ask 300 @ tick 4, bid 300 @ tick 10, all other ticks empty.
// Empty ticks use the BabyJubJub identity (0,1) for c1,c2 (what AuctionHouse.getAggregate
// returns for uninitialized ticks) and claim 0; the last chunk pads virtual ticks 37-39
// the same way. Active ticks use deterministic encryption with nonce r=1 to match the
// on-chain BabyJubJub.encrypt.
//
// Emits: pocd_array_input.json (= chunk 0, used by build_pocd_array.sh's smoke prove),
//        pocd_array_input_k{0..3}.json and matching *_public.json (102 signals each).
import { writeFileSync } from "node:fs";
import { encryptMessage } from "./eerc.mjs";
import { Base8, mulPointEscalar, subOrder } from "@zk-kit/baby-jubjub";

const OUT = process.argv[2] || "../../circuits/build/pocd_array_input.json";
const TICKS = 37;
const CHUNK = 10;
const K = 4;
const PADDED = CHUNK * K; // 40
const auditorPriv = 2748579834902348905823409582340958234n;
const auditorPub = mulPointEscalar(Base8, auditorPriv % subOrder).map(BigInt);

const ID = [0n, 1n]; // identity point

// per-side arrays, padded to 40 ticks
const askC1 = [], askC2 = [], askSum = [];
const bidC1 = [], bidC2 = [], bidSum = [];
for (let t = 0; t < PADDED; t++) {
  askC1.push([...ID]); askC2.push([...ID]); askSum.push(0n);
  bidC1.push([...ID]); bidC2.push([...ID]); bidSum.push(0n);
}

function setCipher(c1Arr, c2Arr, sumArr, tick, value) {
  const { cipher } = encryptMessage(auditorPub, value, 1n); // nonce r=1 (matches on-chain)
  c1Arr[tick] = cipher[0].map(BigInt);
  c2Arr[tick] = cipher[1].map(BigInt);
  sumArr[tick] = value;
}
setCipher(askC1, askC2, askSum, 4, 300n);
setCipher(bidC1, bidC2, bidSum, 10, 300n);

const s = (x) => x.toString();
const pair = (p) => [s(p[0]), s(p[1])];

for (let k = 0; k < K; k++) {
  const lo = k * CHUNK, hi = lo + CHUNK;
  const sl = (a) => a.slice(lo, hi);
  const input = {
    auditorPub: pair(auditorPub),
    askC1: sl(askC1).map(pair), askC2: sl(askC2).map(pair), askSum: sl(askSum).map(s),
    bidC1: sl(bidC1).map(pair), bidC2: sl(bidC2).map(pair), bidSum: sl(bidSum).map(s),
    auditorPriv: s(auditorPriv),
  };
  const out = OUT.replace(".json", `_k${k}.json`);
  writeFileSync(out, JSON.stringify(input, null, 2));
  if (k === 0) writeFileSync(OUT, JSON.stringify(input, null, 2)); // legacy name = chunk 0

  // public signals in the circuit's `public [...]` (grouped) order = MONIAOracle._buildChunkSignals order
  const pub = [
    ...pair(auditorPub),
    ...sl(askC1).flatMap(pair), ...sl(askC2).flatMap(pair), ...sl(askSum).map(s),
    ...sl(bidC1).flatMap(pair), ...sl(bidC2).flatMap(pair), ...sl(bidSum).map(s),
  ];
  writeFileSync(out.replace(".json", "_public.json"), JSON.stringify(pub, null, 2));
  if (k === 0) writeFileSync(OUT.replace(".json", "_public.json"), JSON.stringify(pub, null, 2));
  console.log(`OK: chunk ${k} -> ${out} (${pub.length} signals)`);
}
