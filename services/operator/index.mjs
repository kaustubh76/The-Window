// Operator — the registered vault-operator custody role. Watches CollateralVault
// `LockRequested` (a member locked collateral with a valid solvency proof) and
// confirms the escrow on-chain so LoanBook.confirmFunding can proceed. This is the
// dashboard-driven path; the autonomous admin orchestrator also confirms directly.
import { handles, provider } from "../lib/chain.mjs";
import { OPERATOR_PK } from "../lib/roles.mjs";
import { ethers } from "ethers";
import "dotenv/config";

const POLL_MS = Number(process.env.OPERATOR_POLL_MS || 3000);
const H = handles(OPERATOR_PK);
const seen = new Set();

async function tick() {
  try {
    const nextId = Number(await H.book.nextLoanId());
    for (let id = 0; id < nextId; id++) {
      if (seen.has(id)) continue;
      const lock = await H.vault.locks(id);
      // state: 0 None, 1 Requested, 2 Locked, ...
      if (Number(lock.state) === 1 /*Requested*/) {
        await (await H.vault.confirmLock(id, ethers.id("op-ref-" + id))).wait();
        seen.add(id);
        console.log(`[operator] confirmed collateral escrow for loan ${id}`);
      } else if (Number(lock.state) >= 2) {
        seen.add(id);
      }
    }
  } catch (e) {
    console.error("[operator]", e.message);
  }
}

console.log("[operator] vault-operator custody service running; poll", POLL_MS, "ms");
// self-scheduling (no overlap) — see services/allowlist/index.mjs for the reasoning
const loop = () => setTimeout(async () => { await tick(); loop(); }, POLL_MS);
tick().then(loop);
