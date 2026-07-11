// Fast smoke of the member eERC ops (no PoCD): faucet -> wrap -> balance -> unwrap.
import { provider } from "../services/lib/chain.mjs";
import * as member from "../services/lib/memberops.mjs";

const log = (...a) => console.log("»", ...a);

async function main() {
  await member.registerMember("lender1"); // eERC registration (dashboard: the "register" button)
  log("registered lender1 in eERC");
  await member.faucet("lender1", 10000n);
  log("faucet: minted 10000 tUSDC");
  await member.wrap("lender1", 5000n);
  const b1 = await member.balanceOf("lender1");
  log(`wrap 5000 -> eERC balance decrypts to ${b1.eercClear} (expect 5000)`);
  if (b1.eercClear !== "5000") throw new Error("wrap/balance mismatch");
  await member.unwrap("lender1", 2000n);
  const b2 = await member.balanceOf("lender1");
  log(`unwrap 2000 -> eERC balance decrypts to ${b2.eercClear} (expect 3000)`);
  if (b2.eercClear !== "3000") throw new Error("unwrap/balance mismatch");
  log("\nMEMBER SMOKE: PASS — faucet/wrap/balance/unwrap all correct.");
}
main().then(() => process.exit(0)).catch((e) => { console.error("SMOKE FAIL:", e.message); process.exit(1); });
