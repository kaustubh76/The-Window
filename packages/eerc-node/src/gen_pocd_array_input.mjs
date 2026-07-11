// Generate a witness for the 37-tick DepthCurve array PoCD.
// Scenario: ask 300 @ tick 4, bid 300 @ tick 10, all other ticks empty.
// Empty ticks use the BabyJubJub identity (0,1) for c1,c2 (what AuctionHouse.getAggregate
// returns for uninitialized ticks) and claim 0. Active ticks use deterministic
// encryption with nonce r=1 to match the on-chain BabyJubJub.encrypt.
import { writeFileSync } from "node:fs";
import { encryptMessage } from "./eerc.mjs";
import { Base8, mulPointEscalar, subOrder } from "@zk-kit/baby-jubjub";

const OUT = process.argv[2] || "../../circuits/build/pocd_array_input.json";
const N = 37;
const auditorPriv = 2748579834902348905823409582340958234n;
const auditorPub = mulPointEscalar(Base8, auditorPriv % subOrder).map(BigInt);

const ID = [0n, 1n]; // identity point

// per-side arrays
const askC1 = [], askC2 = [], askSum = [];
const bidC1 = [], bidC2 = [], bidSum = [];
for (let t = 0; t < N; t++) {
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
const input = {
  auditorPub: pair(auditorPub),
  askC1: askC1.map(pair), askC2: askC2.map(pair), askSum: askSum.map(s),
  bidC1: bidC1.map(pair), bidC2: bidC2.map(pair), bidSum: bidSum.map(s),
  auditorPriv: s(auditorPriv),
};
writeFileSync(OUT, JSON.stringify(input, null, 2));

// public signals in the circuit's `public [...]` (grouped) order = MONIAOracle order
const pub = [
  ...pair(auditorPub),
  ...askC1.flatMap(pair), ...askC2.flatMap(pair), ...askSum.map(s),
  ...bidC1.flatMap(pair), ...bidC2.flatMap(pair), ...bidSum.map(s),
];
writeFileSync(OUT.replace(".json", "_public.json"), JSON.stringify(pub, null, 2));
console.log("OK: wrote", OUT, "and *_public.json (", pub.length, "signals )");
