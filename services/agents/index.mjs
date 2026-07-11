// Agents — scripted SIMULATED members that submit encrypted bids each epoch.
// Disclosed everywhere as simulations of member behaviour, not organic discovery.
import { handles } from "../lib/chain.mjs";
import { ACTORS, AGENTS, AUDITOR } from "../lib/actors.mjs";
import { encryptMessage } from "../../packages/eerc-node/src/eerc.mjs";
import "dotenv/config";

const POLL_MS = Number(process.env.AGENTS_POLL_MS || 3000);
let lastBidEpoch = 0;

async function tick() {
  try {
    const anyH = handles();
    const epoch = Number(await anyH.auction.currentEpoch());
    if (epoch === 0) return;
    if (Number(await anyH.auction.epochStatus(epoch)) !== 1 /*Open*/ || epoch === lastBidEpoch) return;

    for (const a of AGENTS) {
      const H = handles(ACTORS[a.actor].pk);
      try {
        const { cipher } = encryptMessage(AUDITOR.pub, a.size);
        const egct = { c1: { x: cipher[0][0], y: cipher[0][1] }, c2: { x: cipher[1][0], y: cipher[1][1] } };
        const tx = a.side === 0 ? await H.auction.submitAsk(a.tick, egct, "0x") : await H.auction.submitBid(a.tick, egct);
        await tx.wait();
        console.log(`[agents] ${a.label} (simulated) ${a.side ? "bid" : "ask"} @ tick ${a.tick}`);
      } catch { /* already bid / not a member — skip */ }
    }
    lastBidEpoch = epoch;
  } catch (e) {
    console.error("[agents]", e.message);
  }
}

console.log(`[agents] ${AGENTS.length} simulated members; poll ${POLL_MS}ms`);
setInterval(tick, POLL_MS);
tick();
