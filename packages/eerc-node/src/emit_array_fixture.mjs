// Emit a Foundry-parseable fixture for the CHUNKED DepthCurve PoCD (4 x 10-tick proofs).
// Scenario MUST match MONIAOracleArrayIntegration.t.sol: ask 300 @ tick 4, bid 300 @ tick 10,
// encrypted to the fixture auditor key with nonce r=1 (same as on-chain BabyJubJub.encrypt).
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Base8, mulPointEscalar, subOrder } from "@zk-kit/baby-jubjub";
import { encryptMessage, genDepthArrayProof } from "./eerc.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const B = resolve(__dir, "../../../circuits/build");
const OUT = resolve(__dir, "../../../contracts/test/fixtures");
mkdirSync(OUT, { recursive: true });

const auditorPriv = 2748579834902348905823409582340958234n; // = FIXTURE_PRIV in the test
const auditorPub = mulPointEscalar(Base8, auditorPriv % subOrder).map(BigInt);

const ID = { c1: { x: 0n, y: 1n }, c2: { x: 0n, y: 1n } };
const askAgg = [], bidAgg = [], askSum = [], bidSum = [];
for (let t = 0; t < 37; t++) { askAgg.push(ID); bidAgg.push(ID); askSum.push(0n); bidSum.push(0n); }

function enc(value) {
  const { cipher } = encryptMessage(auditorPub, value, 1n); // nonce r=1 = on-chain encrypt
  return { c1: { x: BigInt(cipher[0][0]), y: BigInt(cipher[0][1]) }, c2: { x: BigInt(cipher[1][0]), y: BigInt(cipher[1][1]) } };
}
askAgg[4] = enc(300n); askSum[4] = 300n;
bidAgg[10] = enc(300n); bidSum[10] = 300n;

console.log("proving 4 chunk PoCDs (fixture scenario)…");
const t0 = Date.now();
const { proofs } = await genDepthArrayProof(B, auditorPriv, auditorPub, askAgg, bidAgg, askSum, bidSum);
console.log(`proved in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

const fixture = {
  chunks: proofs.map((p) => ({
    a: p.a.map((x) => x.toString()),
    b0: p.b[0].map((x) => x.toString()),
    b1: p.b[1].map((x) => x.toString()),
    c: p.c.map((x) => x.toString()),
    pub: p.publicSignals.map((x) => x.toString()),
  })),
};
writeFileSync(`${OUT}/depth_chunks.json`, JSON.stringify(fixture, null, 2));
console.log(
  "wrote fixtures/depth_chunks.json —",
  fixture.chunks.length, "chunks, pub lengths:",
  fixture.chunks.map((c) => c.pub.length).join(",")
);
