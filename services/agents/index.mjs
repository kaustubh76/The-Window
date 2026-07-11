// Agents — scripted SIMULATED members that submit encrypted bids each epoch.
// Disclosed everywhere as simulations of member behavior, not organic discovery.
import { handles, provider } from "../lib/chain.mjs";
import { encryptMessage } from "../../packages/eerc-node/src/eerc.mjs";
import "dotenv/config";

const auditorPub = [BigInt(process.env.AUDITOR_BJJ_PUB_X), BigInt(process.env.AUDITOR_BJJ_PUB_Y)];
const POLL_MS = Number(process.env.AGENTS_POLL_MS || 3000);

// side: 0 = ask (lender), 1 = bid (borrower). tick index 0..36 -> 1%..10% at 25bps.
const AGENTS = [
  { key: "LENDER1_PK", label: "yield-target lender A", side: 0, tick: 6, size: 400n },
  { key: "LENDER2_PK", label: "yield-target lender B", side: 0, tick: 8, size: 500n },
  { key: "BORROWER_PK", label: "desperate borrower", side: 1, tick: 30, size: 350n },
  { key: "AGENT4_PK", label: "opportunistic borrower", side: 1, tick: 10, size: 300n },
  { key: "AGENT5_PK", label: "noise trader", side: 1, tick: 14, size: 120n },
].filter((a) => process.env[a.key]);

let lastBidEpoch = 0;

async function tick() {
  const anyH = handles();
  const epoch = Number(await anyH.auction.currentEpoch());
  if (epoch === 0) return;
  const status = Number(await anyH.auction.epochStatus(epoch));
  if (status !== 1 /*Open*/ || epoch === lastBidEpoch) return;

  for (const a of AGENTS) {
    const H = handles(process.env[a.key]);
    try {
      const { cipher } = encryptMessage(auditorPub, a.size); // random nonce
      const egct = {
        c1: { x: cipher[0][0], y: cipher[0][1] },
        c2: { x: cipher[1][0], y: cipher[1][1] },
      };
      const tx = a.side === 0
        ? await H.auction.submitAsk(a.tick, egct, "0x")
        : await H.auction.submitBid(a.tick, egct);
      await tx.wait();
      console.log(`[agents] ${a.label} (simulated) ${a.side ? "bid" : "ask"} @ tick ${a.tick}`);
    } catch (e) {
      // already bid this tick / not a member — skip
    }
  }
  lastBidEpoch = epoch;
}

console.log(`[agents] ${AGENTS.length} simulated members; poll ${POLL_MS}ms`);
setInterval(() => tick().catch((e) => console.error("[agents]", e.message)), POLL_MS);
tick().catch((e) => console.error("[agents]", e.message));
