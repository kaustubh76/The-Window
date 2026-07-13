// Agents — scripted SIMULATED members that submit encrypted bids each epoch.
// Disclosed everywhere as simulations of member behaviour, not organic discovery.
import { handles } from "../lib/chain.mjs";
import { ACTORS, AGENTS, agentBids, AUDITOR } from "../lib/actors.mjs";
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
    lastBidEpoch = epoch; // claim BEFORE sending — a slow round must not re-enter the same epoch

    for (const a of agentBids(epoch)) {
      const H = handles(ACTORS[a.actor].pk);
      try {
        // Re-sync the cached NonceManager: other services (admin loan ops, control API)
        // send txs from these same member keys, and a stale cached nonce silently
        // stalls every later bid (the root cause of the epoch-260+ NoTrade streak).
        H.auction.runner.reset?.();
        const { cipher } = encryptMessage(AUDITOR.pub, a.size);
        const egct = { c1: { x: cipher[0][0], y: cipher[0][1] }, c2: { x: cipher[1][0], y: cipher[1][1] } };
        const tx = a.side === 0 ? await H.auction.submitAsk(a.tick, egct, "0x") : await H.auction.submitBid(a.tick, egct);
        await tx.wait();
        console.log(`[agents] ${a.label} (simulated) ${a.side ? "bid" : "ask"} @ tick ${a.tick}`);
      } catch (e) {
        // skip this agent this epoch, but NEVER silently (a swallowed revert here hid a dead market)
        console.error(`[agents] ${a.actor} ${a.side ? "bid" : "ask"} failed: ${e.shortMessage || e.message}`);
      }
    }
  } catch (e) {
    console.error("[agents]", e.message);
  }
}

console.log(`[agents] ${AGENTS.length} simulated members; poll ${POLL_MS}ms`);
// self-scheduling: a bid round (5 × send+confirm) outlasts POLL_MS on a real chain;
// setInterval overlaps rounds and double-submits (on-chain AlreadyBidHere reverts +
// NonceManager desync) — same reasoning as services/allowlist/index.mjs.
const loop = () => setTimeout(async () => { await tick(); loop(); }, POLL_MS);
tick().then(loop);
