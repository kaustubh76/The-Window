// Fund all WINDOW actor EOAs on Fuji with gas AVAX from the faucet wallet.
// Source: WALLET_PRIVATE_KEY in root .env (the account you fed from https://faucet.avax.network).
// Idempotent: tops each actor up to its target balance, skips if already there.
// Run from services/ so ethers resolves:  cd services && node ../scripts/fund_fuji.mjs
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { config } from "dotenv";

const __dir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dir, "../.env") });
const require = createRequire(resolve(__dir, "../services/package.json"));
const { Wallet, JsonRpcProvider, formatEther, parseEther } = require("ethers");

const RPC = process.env.RPC_FUJI || "https://api.avax-test.network/ext/bc/C/rpc";
const provider = new JsonRpcProvider(RPC);

const SRC_PK = process.env.WALLET_PRIVATE_KEY;
if (!SRC_PK) { console.error("WALLET_PRIVATE_KEY missing in .env"); process.exit(1); }
const src = new Wallet(SRC_PK.startsWith("0x") ? SRC_PK : "0x" + SRC_PK, provider);

// target balances (AVAX): admin deploys the whole stack + prints every epoch
const TARGETS = [
  ["ADMIN_PK", "0.5"],
  ["KEEPER_PK", "0.1"],
  ["VAULT_OPERATOR_PK", "0.05"],
  ["LENDER1_PK", "0.05"],
  ["LENDER2_PK", "0.05"],
  ["BORROWER_PK", "0.05"],
  ["AGENT4_PK", "0.05"],
  ["AGENT5_PK", "0.05"],
];

const srcBal = await provider.getBalance(src.address);
console.log(`source ${src.address}: ${formatEther(srcBal)} AVAX`);

for (const [env, target] of TARGETS) {
  const pk = process.env[env];
  if (!pk) { console.error(`${env} missing in .env — aborting`); process.exit(1); }
  const addr = new Wallet(pk).address;
  const bal = await provider.getBalance(addr);
  const want = parseEther(target);
  if (bal >= want) {
    console.log(`${env.padEnd(18)} ${addr}  ${formatEther(bal)} AVAX (ok)`);
    continue;
  }
  const topUp = want - bal;
  const tx = await src.sendTransaction({ to: addr, value: topUp });
  await tx.wait();
  console.log(`${env.padEnd(18)} ${addr}  +${formatEther(topUp)} AVAX -> ${target}`);
}
console.log(`source after: ${formatEther(await provider.getBalance(src.address))} AVAX`);
