// Generate fresh THROWAWAY test keys for THE WINDOW (Fuji testnet only).
// Writes a .env at repo root (gitignored). Never commit real funds to these.
import { writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { buildBabyjub } from "circomlibjs";

const jub = await buildBabyjub();
const subOrder = jub.subOrder; // BJJ scalar field order

function randScalarBelow(n) {
  while (true) {
    const x = BigInt("0x" + randomBytes(32).toString("hex"));
    if (x < n && x > 0n) return x;
  }
}
function randEoaPk() {
  return "0x" + randomBytes(32).toString("hex");
}

const roles = ["LENDER1", "LENDER2", "BORROWER", "ADMIN", "KEEPER", "VAULT_OPERATOR"];
let env = `# THE WINDOW — throwaway test keys (Fuji testnet only). GITIGNORED. Do not commit.\n`;
env += `PROFILE=DEMO\n`;
env += `RPC_LOCAL=http://127.0.0.1:8545\n`;
env += `RPC_FUJI=https://api.avax-test.network/ext/bc/C/rpc\n`;
env += `CHAIN_ID_FUJI=43113\n\n`;

for (const r of roles) {
  env += `${r}_PK=${randEoaPk()}\n`;
}
env += `\n# Auditor = ADMIN. BabyJubJub scalar for eERC auditor decryption.\n`;
const auditorPriv = randScalarBelow(subOrder);
const auditorPub = jub.mulPointEscalar(jub.Base8, auditorPriv);
env += `AUDITOR_BJJ_PRIV=${auditorPriv.toString()}\n`;
env += `AUDITOR_BJJ_PUB_X=${jub.F.toObject(auditorPub[0]).toString()}\n`;
env += `AUDITOR_BJJ_PUB_Y=${jub.F.toObject(auditorPub[1]).toString()}\n`;

writeFileSync(new URL("../../../.env", import.meta.url), env);
console.log("Wrote .env with", roles.length, "EOAs + auditor BJJ keypair (gitignored).");
