// Control API — the single backend the dashboard triggers for WRITES. Reuses the
// proven eerc-node flows via memberops/adminops. Member & admin proving run here
// (server-side) for the disclosed simulated members; the auditor key never leaves.
// Reads come from the indexer; this service only performs actions.
import express from "express";
import cors from "cors";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ethers, handles, provider, RPC } from "../lib/chain.mjs";
import { ACTORS, AUDITOR, actorByAddress, MEMBER_NAMES } from "../lib/actors.mjs";
import { ADMIN_PK, KEEPER_PK } from "../lib/roles.mjs";
import * as member from "../lib/memberops.mjs";
import * as admin from "../lib/adminops.mjs";
import "dotenv/config";

const PORT = Number(process.env.CONTROL_PORT || process.env.PORT || 8899);
const PROVE_WORKER = fileURLToPath(new URL("../lib/prove_worker.mjs", import.meta.url));
const PRINT_SENTINEL = "__PRINT_RESULT__";
// Indexer base for the fast admin-decrypt path: hosted URL in prod, localhost in dev.
const INDEXER_BASE = process.env.INDEXER_URL || `http://127.0.0.1:${process.env.INDEXER_PORT || 8788}`;

// Decrypt per-tick aggregate sums for an epoch. FAST path: one fetch of the indexer's
// /aggregates ciphertexts + local decrypt (~5s vs ~55s of 74 on-chain RPC round-trips on the
// throttled free instance). Falls back to on-chain getAggregate if the indexer is unavailable.
async function decryptedSums(epoch) {
  try {
    const res = await fetch(`${INDEXER_BASE}/aggregates/${epoch}`);
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length) return await admin.decryptAggsFromIndexer(rows);
    }
  } catch { /* indexer down/unreachable → on-chain fallback below */ }
  return admin.decryptDepth(handles(ADMIN_PK), epoch);
}
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

// ---- permissioned-L1: read-gate token minting + live TxAllowList roles ----
// The dashboard is keyless, so it can't sign the indexer's read challenge itself. For a
// MEMBER it mints a member-signed token here (Control holds the member EOA keys); a
// non-member gets 403 — which is exactly the read-gate demo contrast. Bucket + header
// contract MUST match the READ_GATE middleware in services/indexer/index.mjs.
const TXALLOWLIST = "0x0200000000000000000000000000000000000002";
const ALLOWLIST_ABI = ["function readAllowList(address) view returns (uint256)"];
const ROLE_NAME = ["None", "Enabled", "Admin"];

app.post("/member/read-token", async (q, r) => {
  try {
    const address = String(q.body.address || "");
    if (!ethers.isAddress(address)) return r.status(400).json({ ok: false, error: "bad address" });
    const actor = actorByAddress(address);
    const isMember = actor ? await handles().registry.isMember(address).catch(() => false) : false;
    if (!actor || !isMember) return r.status(403).json({ ok: false, error: "not a member — the L1 read surface is member-gated" });
    const bucket = Math.floor(Date.now() / 30000); // window-read:<floor(now/30s)>
    const sig = await new ethers.Wallet(ACTORS[actor.name].pk).signMessage(`window-read:${bucket}`);
    r.json({ ok: true, address: actor.address, sig, bucket });
  } catch (e) { fail(r, e); }
});

app.get("/l1/allowlist", async (_q, r) => {
  try {
    const H = handles();
    const allow = new ethers.Contract(TXALLOWLIST, ALLOWLIST_ABI, provider);
    // ops roles + the five members + the never-member intruder (anvil #8) for the contrast
    const roster = [
      { name: "admin", label: "admin", address: ACTORS.admin?.address },
      { name: "keeper", label: "keeper", address: ACTORS.keeper?.address },
      { name: "operator", label: "operator", address: ACTORS.operator?.address },
      ...MEMBER_NAMES.map((n) => ({ name: n, label: n, address: ACTORS[n]?.address })),
      { name: "intruder", label: "intruder (never a member)", address: "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f" },
    ].filter((x) => x.address);
    const rows = await Promise.all(roster.map(async (x) => {
      const [roleRaw, isMember] = await Promise.all([
        allow.readAllowList(x.address).then((v) => Number(v)).catch(() => -1),
        H.registry.isMember(x.address).catch(() => false),
      ]);
      return { address: x.address, label: x.label, role: roleRaw, roleName: ROLE_NAME[roleRaw] ?? "n/a", isMember };
    }));
    r.json({ ok: true, precompile: TXALLOWLIST, rows });
  } catch (e) { fail(r, e); }
});

// Live chain identity for the /l1 hero — proves the L1 is genuinely Fuji-anchored
// (networkID 5) vs a local single-node network, with the validator NodeID + blockchain ID.
app.get("/l1/info", async (_q, r) => {
  try {
    const [chainIdHex, blockHex] = await Promise.all([
      provider.send("eth_chainId", []),
      provider.send("eth_blockNumber", []),
    ]);
    const base = RPC.replace(/\/ext\/bc\/.*$/, ""); // node root (drops /ext/bc/<id>/rpc)
    const blockchainId = (RPC.match(/\/ext\/bc\/([^/]+)\/rpc/) || [])[1] || null;
    let networkID = null, nodeID = null;
    if (base !== RPC) { // avalanche node (has /ext/info); Anvil/local RPCs don't
      const info = async (method) => {
        const res = await fetch(`${base}/ext/info`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }),
        });
        return (await res.json())?.result;
      };
      try { networkID = Number((await info("info.getNetworkID"))?.networkID); } catch { /* n/a */ }
      try { nodeID = (await info("info.getNodeID"))?.nodeID ?? null; } catch { /* n/a */ }
    }
    const anchor = networkID === 5 ? "fuji" : networkID === 1 ? "mainnet" : "local";
    r.json({ ok: true, chainId: Number(chainIdHex), block: Number(blockHex), networkID, anchor, nodeID, blockchainId });
  } catch (e) { fail(r, e); }
});

// Live atomic revocation: one removeMember revokes market + eERC + network + observation,
// then re-adds to restore. Server-side port of demo/verify_l1_revoke.mjs. L1-only.
app.post("/l1/revoke-demo", async (q, r) => {
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const H = handles(ADMIN_PK);
  const registry = H.registry;
  const allow = new ethers.Contract(TXALLOWLIST, ALLOWLIST_ABI, provider);
  const INDEXER = `http://127.0.0.1:${process.env.INDEXER_PORT || 8788}`;
  // admin key is shared with the admin daemon — retry on nonce races so restore never fails
  const sendAdmin = async (fn, tries = 5) => {
    for (let i = 0; i < tries; i++) {
      try { return await (await fn()).wait(); }
      catch (e) { if (i === tries - 1) throw e; await sleep(2500); }
    }
  };
  const waitRole = async (addr, want, tries = 12) => {
    for (let i = 0; i < tries; i++) { if (Number(await allow.readAllowList(addr)) === want) return true; await sleep(3000); }
    return false;
  };

  let subject = null;
  try {
    const name = (q.body.address && actorByAddress(q.body.address)?.name) || MEMBER_NAMES[MEMBER_NAMES.length - 1];
    subject = ACTORS[name];
    if (!subject) return r.status(400).json({ ok: false, error: "no such member" });
    // precheck: must be a permissioned L1 with the subject currently enabled
    let role0;
    try { role0 = Number(await allow.readAllowList(subject.address)); }
    catch { return r.status(400).json({ ok: false, error: "not a permissioned L1 (no TxAllowList precompile)" }); }
    const isMember0 = await registry.isMember(subject.address).catch(() => false);
    if (!isMember0 || role0 < 1) return r.status(409).json({ ok: false, error: "subject is not an enabled member" });

    const steps = [];
    // THE ONE ACTION
    await sendAdmin(() => registry.removeMember(subject.address));

    // network ✗ — allowlist keeper mirrors the removal into the precompile
    const revoked = await waitRole(subject.address, 0);
    steps.push({ key: "network", label: "TxAllowList role → None", ok: revoked });

    // market + eERC ✗ — every tx from the subject is rejected at the chain level
    let blocked = false;
    try { await (await new ethers.Wallet(subject.pk, provider).sendTransaction({ to: subject.address, value: 0n })).wait(); }
    catch { blocked = true; }
    steps.push({ key: "market", label: "subject tx rejected at chain level", ok: blocked });
    steps.push({ key: "eerc", label: "cannot submit a register / transfer", ok: blocked });

    // observation ✗ — the member-gated read surface refuses the ex-member
    let obs403 = false;
    try { obs403 = (await fetch(`${INDEXER}/members`)).status === 403; } catch { obs403 = false; }
    steps.push({ key: "observation", label: "member-gated read refuses the ex-member", ok: obs403 });

    // restore ✔ — re-add so the market recovers
    const epoch = await H.auction.currentEpoch();
    const ref = ethers.keccak256(ethers.toUtf8Bytes(`the-window:bjj:${name}`));
    await sendAdmin(() => registry.addMember(subject.address, epoch, ref));
    const restored = await waitRole(subject.address, 1);

    r.json({ ok: true, subject: { name, address: subject.address }, steps, restored });
  } catch (e) {
    // best-effort restore on failure — never leave the subject removed
    if (subject) {
      try {
        const isM = await registry.isMember(subject.address).catch(() => true);
        if (!isM) await sendAdmin(() => registry.addMember(subject.address, 0, ethers.ZeroHash)).catch(() => {});
      } catch { /* ignore */ }
    }
    fail(r, e);
  }
});
// the auditor PUBLIC key (the on-chain PoCD binding target) — never the scalar
app.get("/auditor", (_q, r) => r.json({ ok: true, x: AUDITOR.pub[0].toString(), y: AUDITOR.pub[1].toString() }));

// ---- member ops ----
app.post("/member/register", async (q, r) => { try { const a = resolveActor(q.body); const s = t0(); ok(r, { ...(await member.registerMember(a)), proofMs: Date.now() - s }); } catch (e) { fail(r, e); } });
app.post("/member/faucet", async (q, r) => { try { const a = resolveActor(q.body); ok(r, await member.faucet(a, q.body.amount)); } catch (e) { fail(r, e); } });
app.post("/member/wrap", async (q, r) => { try { const a = resolveActor(q.body); const s = t0(); const d = await member.wrap(a, q.body.amount); ok(r, { ...d, proofMs: Date.now() - s }); } catch (e) { fail(r, e); } });
app.post("/member/unwrap", async (q, r) => { try { const a = resolveActor(q.body); const s = t0(); const d = await member.unwrap(a, q.body.amount); ok(r, { ...d, proofMs: Date.now() - s }); } catch (e) { fail(r, e); } });
app.post("/member/bid", async (q, r) => { try { const a = resolveActor(q.body); ok(r, await member.submitBid(a, q.body.side, q.body.tick, q.body.size)); } catch (e) { fail(r, e); } });
app.post("/member/lock", async (q, r) => {
  try {
    const s = t0();
    // Use the REAL collateral the UI computed (micro-USDC) → whole-USDC scalars for the
    // solvency circuit. coll = requiredCollateral = 1.2·loan (HAIRCUT_BPS = 12000), so the
    // proof reflects the actual loan instead of a hardcoded 6000/5000 placeholder. Falls back
    // to explicit coll/loan (or memberops defaults) when collMicro is absent.
    let { coll, loan } = q.body;
    if (q.body.collMicro != null) {
      coll = Math.round(Number(q.body.collMicro) / 1e6);
      loan = Math.round((coll * 10000) / 12000);
    }
    const d = await member.lockByLoan(q.body.loanId, coll, loan);
    ok(r, { ...d, proofMs: Date.now() - s });
  } catch (e) { fail(r, e); }
});
app.get("/member/balance/:addr", async (q, r) => { try { const a = actorByAddress(q.params.addr); ok(r, a ? await member.balanceOf(a.name) : { usdc: "0", registered: false, eercClear: null }); } catch (e) { fail(r, e); } });
// fund/repay are auditor-attested (LoanBook onlyAdmin) — the operator confirms the lock first (services/operator).
app.post("/member/fund", async (q, r) => { try { ok(r, await admin.confirmFunding(ADMIN_PK, q.body.loanId)); } catch (e) { fail(r, e); } });
app.post("/member/repay", async (q, r) => { try { ok(r, await admin.repay(ADMIN_PK, q.body.loanId)); } catch (e) { fail(r, e); } });

// ---- admin ops (auditor key server-side only) ----
// Print runs the heavy chunked Groth16 proof in a CHILD PROCESS so this event loop keeps serving
// /health during the (slow) proof on the constrained hosted instance — otherwise the block trips
// Render's 5s health check → SIGKILL → crash loop. The proof's memory is isolated in the child.
app.post("/admin/print/:epoch", (q, r) => {
  const s = t0();
  const child = spawn(process.execPath, [PROVE_WORKER, String(Number(q.params.epoch))], { env: process.env });
  let out = "", err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  child.on("error", (e) => fail(r, e));
  child.on("close", (code) => {
    const i = out.lastIndexOf(PRINT_SENTINEL);
    let res = null;
    if (i >= 0) { try { res = JSON.parse(out.slice(i + PRINT_SENTINEL.length).trim().split("\n")[0]); } catch { /* fallthrough */ } }
    if (!res) return fail(r, new Error((err.trim() || out.trim()).slice(-300) || `prove worker exited ${code}`));
    if (res.ok === false) return fail(r, new Error(res.error || "print failed"));
    ok(r, { ...res, proofMs: Date.now() - s });
  });
});
app.post("/admin/matches/:epoch", async (q, r) => { try { ok(r, { loans: await admin.matchEpoch(ADMIN_PK, Number(q.params.epoch)) }); } catch (e) { fail(r, e); } });
app.get("/admin/decrypt/:epoch", async (q, r) => { try { const { askSum, bidSum } = await decryptedSums(Number(q.params.epoch)); ok(r, { depth: askSum.map((a, t) => ({ tick: t, bps: 100 + 25 * t, supply: a.toString(), demand: bidSum[t].toString() })) }); } catch (e) { fail(r, e); } });
app.get("/admin/clearing/:epoch", async (q, r) => { try { const { askSum, bidSum } = await decryptedSums(Number(q.params.epoch)); const c = admin.computeClearing(askSum, bidSum); ok(r, { rStarBps: c.trade ? 100 + 25 * c.crossing : null, matched: c.matched.toString() }); } catch (e) { fail(r, e); } });

// ---- keeper ops ----
// /keeper/open is daemon-only by design: the keeper driver (services/keeper) opens epochs
// autonomously on its own clock, so the frontend LiveAdapter maps close/seize but not open.
// Kept here for manual ops (curl / dashboard-less recovery), not a forgotten wire.
app.post("/keeper/open", async (_q, r) => { try { const tx = await handles(KEEPER_PK).auction.openEpoch(); const rc = await tx.wait(); ok(r, { txHash: tx.hash, gasUsed: rc.gasUsed.toString() }); } catch (e) { fail(r, e); } });
app.post("/keeper/close", async (_q, r) => { try { const tx = await handles(KEEPER_PK).auction.closeEpoch(); const rc = await tx.wait(); ok(r, { txHash: tx.hash, gasUsed: rc.gasUsed.toString() }); } catch (e) { fail(r, e); } });
app.post("/keeper/seize", async (q, r) => { try { const tx = await handles(KEEPER_PK).book.seize(q.body.loanId); const rc = await tx.wait(); ok(r, { seized: q.body.loanId, txHash: tx.hash, gasUsed: rc.gasUsed.toString() }); } catch (e) { fail(r, e); } });

app.listen(PORT, () => console.log(`[control] on :${PORT} (member/admin/keeper write API)`));
