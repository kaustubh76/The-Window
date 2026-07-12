// Control API — the single backend the dashboard triggers for WRITES. Reuses the
// proven eerc-node flows via memberops/adminops. Member & admin proving run here
// (server-side) for the disclosed simulated members; the auditor key never leaves.
// Reads come from the indexer; this service only performs actions.
import express from "express";
import cors from "cors";
import { handles } from "../lib/chain.mjs";
import { ACTORS, actorByAddress } from "../lib/actors.mjs";
import { ADMIN_PK, KEEPER_PK } from "../lib/roles.mjs";
import * as member from "../lib/memberops.mjs";
import * as admin from "../lib/adminops.mjs";
import "dotenv/config";

const PORT = Number(process.env.CONTROL_PORT || 8899);
const app = express();
app.use(cors());
app.use(express.json());

// resolve {actor|address} in the body to an actor name
function resolveActor(body) {
  if (body.actor && ACTORS[body.actor]) return body.actor;
  const a = actorByAddress(body.address || body.actor);
  return a ? a.name : null;
}

const ok = (res, data) => res.json({ ok: true, ...data });
const fail = (res, e) => { console.error("[control]", e.message); res.status(400).json({ ok: false, error: e.message }); };
const t0 = () => Date.now();

app.get("/health", (_q, r) => r.json({ ok: true }));
app.get("/actors", (_q, r) => r.json(Object.values(ACTORS).map((a) => ({ name: a.name, address: a.address, role: a.role }))));

// ---- member ops ----
app.post("/member/register", async (q, r) => { try { const a = resolveActor(q.body); const s = t0(); ok(r, { ...(await member.registerMember(a)), proofMs: Date.now() - s }); } catch (e) { fail(r, e); } });
app.post("/member/faucet", async (q, r) => { try { const a = resolveActor(q.body); ok(r, await member.faucet(a, q.body.amount)); } catch (e) { fail(r, e); } });
app.post("/member/wrap", async (q, r) => { try { const a = resolveActor(q.body); const s = t0(); const d = await member.wrap(a, q.body.amount); ok(r, { ...d, proofMs: Date.now() - s }); } catch (e) { fail(r, e); } });
app.post("/member/unwrap", async (q, r) => { try { const a = resolveActor(q.body); const s = t0(); const d = await member.unwrap(a, q.body.amount); ok(r, { ...d, proofMs: Date.now() - s }); } catch (e) { fail(r, e); } });
app.post("/member/bid", async (q, r) => { try { const a = resolveActor(q.body); ok(r, await member.submitBid(a, q.body.side, q.body.tick, q.body.size)); } catch (e) { fail(r, e); } });
app.post("/member/lock", async (q, r) => { try { const s = t0(); const d = await member.lockByLoan(q.body.loanId, q.body.coll, q.body.loan); ok(r, { ...d, proofMs: Date.now() - s }); } catch (e) { fail(r, e); } });
app.get("/member/balance/:addr", async (q, r) => { try { const a = actorByAddress(q.params.addr); ok(r, a ? await member.balanceOf(a.name) : { usdc: "0", registered: false, eercClear: null }); } catch (e) { fail(r, e); } });
// fund/repay are auditor-attested (LoanBook onlyAdmin) — the operator confirms the lock first (services/operator).
app.post("/member/fund", async (q, r) => { try { ok(r, await admin.confirmFunding(ADMIN_PK, q.body.loanId)); } catch (e) { fail(r, e); } });
app.post("/member/repay", async (q, r) => { try { ok(r, await admin.repay(ADMIN_PK, q.body.loanId)); } catch (e) { fail(r, e); } });

// ---- admin ops (auditor key server-side only) ----
app.post("/admin/print/:epoch", async (q, r) => { try { const s = t0(); const d = await admin.printEpoch(ADMIN_PK, Number(q.params.epoch)); ok(r, { ...d, proofMs: Date.now() - s }); } catch (e) { fail(r, e); } });
app.post("/admin/matches/:epoch", async (q, r) => { try { ok(r, { loans: await admin.matchEpoch(ADMIN_PK, Number(q.params.epoch)) }); } catch (e) { fail(r, e); } });
app.get("/admin/decrypt/:epoch", async (q, r) => { try { const H = handles(ADMIN_PK); const { askSum, bidSum } = await admin.decryptDepth(H, Number(q.params.epoch)); ok(r, { depth: askSum.map((a, t) => ({ tick: t, bps: 100 + 25 * t, supply: a.toString(), demand: bidSum[t].toString() })) }); } catch (e) { fail(r, e); } });
app.get("/admin/clearing/:epoch", async (q, r) => { try { const H = handles(ADMIN_PK); const { askSum, bidSum } = await admin.decryptDepth(H, Number(q.params.epoch)); const c = admin.computeClearing(askSum, bidSum); ok(r, { rStarBps: c.trade ? 100 + 25 * c.crossing : null, matched: c.matched.toString() }); } catch (e) { fail(r, e); } });

// ---- keeper ops ----
app.post("/keeper/open", async (_q, r) => { try { const tx = await handles(KEEPER_PK).auction.openEpoch(); const rc = await tx.wait(); ok(r, { txHash: tx.hash, gasUsed: rc.gasUsed.toString() }); } catch (e) { fail(r, e); } });
app.post("/keeper/close", async (_q, r) => { try { const tx = await handles(KEEPER_PK).auction.closeEpoch(); const rc = await tx.wait(); ok(r, { txHash: tx.hash, gasUsed: rc.gasUsed.toString() }); } catch (e) { fail(r, e); } });
app.post("/keeper/seize", async (q, r) => { try { const tx = await handles(KEEPER_PK).book.seize(q.body.loanId); const rc = await tx.wait(); ok(r, { seized: q.body.loanId, txHash: tx.hash, gasUsed: rc.gasUsed.toString() }); } catch (e) { fail(r, e); } });

app.listen(PORT, () => console.log(`[control] on :${PORT} (member/admin/keeper write API)`));
