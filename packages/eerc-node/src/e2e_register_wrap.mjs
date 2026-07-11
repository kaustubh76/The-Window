// D1 e2e: against the deployed eERC stack on local Anvil —
//   register admin(auditor) + userA + userB -> set auditor -> mint+wrap USDC for A
//   -> encrypted transfer A->B -> decrypt both balances.
// Proves the full eERC settlement path THE WINDOW relies on.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ethers } from "ethers";
import {
  genUser, genRegistrationProof, genTransferProof,
  processPoseidonEncryption, decryptEGCT,
} from "./eerc.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const CROOT = resolve(__dir, "../../../contracts");
const dep = JSON.parse(readFileSync(`${CROOT}/deployments/31337.json`, "utf8"));
const abi = (n, s = n) => JSON.parse(readFileSync(`${CROOT}/out/${s}.sol/${n}.json`, "utf8")).abi;

const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
const chainId = 31337n;

// Distinct anvil accounts: #0 owner/admin/auditor, #1 lender A, #2 borrower B.
const keys = {
  admin: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  A: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  B: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
};
const w = (k) => new ethers.NonceManager(new ethers.Wallet(k, provider));
const wa = { admin: w(keys.admin), A: w(keys.A), B: w(keys.B) };
const addr = {
  admin: new ethers.Wallet(keys.admin).address,
  A: new ethers.Wallet(keys.A).address,
  B: new ethers.Wallet(keys.B).address,
};

const usdc = new ethers.Contract(dep.TESTUSDC_ADDR, abi("SimpleERC20"), wa.A);
const registrar = (s) => new ethers.Contract(dep.REGISTRAR_ADDR, abi("Registrar"), wa[s]);
const eerc = (s) => new ethers.Contract(dep.EERC_ADDR, abi("EncryptedERC"), wa[s]);

async function register(user, who) {
  const p = await genRegistrationProof(user, addr[who], chainId);
  const tx = await registrar(who).register({ proofPoints: { a: p.a, b: p.b, c: p.c }, publicSignals: p.publicSignals });
  await tx.wait();
  const ok = await registrar(who).isUserRegistered(addr[who]);
  console.log(`register ${who}: ${ok ? "OK" : "FAIL"}`);
  if (!ok) throw new Error(`register ${who} failed`);
}

const users = { admin: genUser(), A: genUser(), B: genUser() };

// 1. register all three
await register(users.admin, "admin");
await register(users.A, "A");
await register(users.B, "B");

// 2. auditor = admin
let tx = await eerc("admin").setAuditorPublicKey(addr.admin); await tx.wait();
console.log("auditor set:", await eerc("admin").isAuditorKeySet());
const auditorPub = users.admin.publicKey;

// 3. mint + wrap for A. Small unit amounts keep the eGCT BSGS decryption fast;
//    the admin service will use the Poseidon balancePCT for large real balances.
const amount = 5000n;
tx = await usdc.mint(addr.A, amount); await tx.wait();
tx = await usdc.approve(dep.EERC_ADDR, amount); await tx.wait();
const pctA = processPoseidonEncryption([amount], users.A.publicKey);
tx = await eerc("A")["deposit(uint256,address,uint256[7])"](
  amount, dep.TESTUSDC_ADDR, [...pctA.ciphertext, ...pctA.authKey, pctA.nonce]
);
await tx.wait();

const readEGCT = async (who) => {
  const b = await eerc(who).balanceOf(addr[who], 1n);
  return {
    obj: { c1: { x: b.eGCT.c1.x, y: b.eGCT.c1.y }, c2: { x: b.eGCT.c2.x, y: b.eGCT.c2.y } },
    flat: [b.eGCT.c1.x, b.eGCT.c1.y, b.eGCT.c2.x, b.eGCT.c2.y].map(BigInt),
  };
};
let balA = await readEGCT("A");
const decA0 = decryptEGCT(users.A.privateKey, balA.obj, 1 << 21);
console.log(`A wrapped balance: ${decA0} (expected ${amount})`);
if (decA0 !== amount) throw new Error("wrap balance mismatch");

// 4. encrypted transfer A -> B
const xfer = 2000n;
const tp = await genTransferProof(users.A, amount, users.B.publicKey, xfer, balA.flat, auditorPub);
tx = await eerc("A").transfer(
  addr.B, 1n,
  { proofPoints: { a: tp.a, b: tp.b, c: tp.c }, publicSignals: tp.publicSignals },
  tp.senderBalancePCT
);
const rc = await tx.wait();
console.log("transfer A->B mined, gas:", rc.gasUsed.toString());

// 5. decrypt both post-transfer balances
const balB = await readEGCT("B");
const decB = decryptEGCT(users.B.privateKey, balB.obj, 1 << 21);
balA = await readEGCT("A");
const decA1 = decryptEGCT(users.A.privateKey, balA.obj, 1 << 21);
console.log(`B received balance: ${decB} (expected ${xfer})`);
console.log(`A remaining balance: ${decA1} (expected ${amount - xfer})`);

const pass = decB === xfer && decA1 === amount - xfer;
console.log(pass ? "\nREGISTER+WRAP+TRANSFER e2e: PASS ✅" : "\ne2e: FAIL ❌");
process.exit(pass ? 0 : 1);
