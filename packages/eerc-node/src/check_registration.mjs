// Offline sanity: generate a registration proof with the prebuilt eERC circuit
// and verify it against the shipped verification key.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as snarkjs from "snarkjs";
import { genUser, genRegistrationProof } from "./eerc.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const vkeyPath = resolve(
  __dir,
  "../../../contracts/lib/EncryptedERC/circom/build/registration/registration_verification_key.json"
);

const chainId = 31337n;
const eoa = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // anvil #0
const user = genUser();

const { a, b, c, publicSignals, registrationHash } = await genRegistrationProof(user, eoa, chainId);

// Reconstruct raw proof/publicSignals for snarkjs verify
const { proof, publicSignals: rawPub } = await snarkjs.groth16.fullProve(
  {
    SenderPrivateKey: user.formattedPrivateKey,
    SenderPublicKey: user.publicKey,
    SenderAddress: BigInt(eoa),
    ChainID: chainId,
    RegistrationHash: registrationHash,
  },
  resolve(__dir, "../../../contracts/lib/EncryptedERC/circom/build/registration/registration.wasm"),
  resolve(__dir, "../../../contracts/lib/EncryptedERC/circom/build/registration/circuit_final.zkey")
);

const vkey = JSON.parse(readFileSync(vkeyPath, "utf8"));
const ok = await snarkjs.groth16.verify(vkey, rawPub, proof);

console.log("registrationHash:", registrationHash.toString());
console.log("publicSignals (5):", publicSignals);
console.log("snarkjs verify:", ok ? "OK ✅" : "FAILED ❌");
process.exit(ok ? 0 : 1);
