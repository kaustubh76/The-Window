// Isolate InvalidProof: call the deployed RegistrationCircuitGroth16Verifier
// directly with a freshly generated proof.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ethers } from "ethers";
import { genUser, genRegistrationProof } from "./eerc.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const CROOT = resolve(__dir, "../../../contracts");
const dep = JSON.parse(readFileSync(`${CROOT}/deployments/31337.json`, "utf8"));
const vAbi = JSON.parse(
  readFileSync(`${CROOT}/out/RegistrationCircuitGroth16Verifier.sol/RegistrationCircuitGroth16Verifier.json`, "utf8")
).abi;

const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
const verifier = new ethers.Contract(dep.REGISTRATION_VERIFIER, vAbi, provider);

const eoa = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const user = genUser();
const p = await genRegistrationProof(user, eoa, 31337n);

console.log("publicSignals:", p.publicSignals);
const ok = await verifier.verifyProof(p.a, p.b, p.c, p.publicSignals);
console.log("deployed verifier verifyProof:", ok);
process.exit(0);
