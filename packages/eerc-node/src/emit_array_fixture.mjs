// Emit a Foundry-parseable fixture for the 37-tick DepthCurve array PoCD proof.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { formatProof } from "./eerc.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const B = resolve(__dir, "../../../circuits/build");
const OUT = resolve(__dir, "../../../contracts/test/fixtures");
mkdirSync(OUT, { recursive: true });

const proof = JSON.parse(readFileSync(`${B}/depth_array_proof.json`, "utf8"));
const pub = JSON.parse(readFileSync(`${B}/depth_array_publicsig.json`, "utf8"));
const { a, b, c, publicSignals } = await formatProof(proof, pub);

const fixture = {
  a: a.map((x) => x.toString()),
  b0: b[0].map((x) => x.toString()),
  b1: b[1].map((x) => x.toString()),
  c: c.map((x) => x.toString()),
  pub: publicSignals.map((x) => x.toString()),
};
writeFileSync(`${OUT}/depth_array.json`, JSON.stringify(fixture, null, 2));
console.log("wrote fixtures/depth_array.json (pub length", fixture.pub.length, ")");
