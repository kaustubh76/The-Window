// Drivers supervisor — runs the four autonomous drivers (keeper, agents, operator,
// admin) in ONE container so the Fuji market advances from cloud compute (chained
// GitHub Actions jobs — see .github/workflows/fuji-drivers.yml) instead of a laptop.
// Children are restarted if they die: every driver is stateless and idempotent
// (on-chain state is the source of truth), so a restart just resumes the loop.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const SERVICES = resolve(dirname(fileURLToPath(import.meta.url)), ".."); // children run as `node <svc>/index.mjs` with cwd=services/
const DRIVERS = ["keeper", "agents", "operator", "admin"];
// Max silence before a child is presumed WEDGED (hung on an unresolved await, not crashed).
const HEARTBEAT_MS = Number(process.env.DRIVER_HEARTBEAT_MS || 8 * 60 * 1000);
const children = new Map(); // name -> ChildProcess (current)
const lastSeen = new Map(); // name -> ms of last stdout/stderr line

function start(name) {
  const child = spawn("node", [`${name}/index.mjs`], { cwd: SERVICES, env: process.env });
  children.set(name, child);
  lastSeen.set(name, Date.now());
  const bump = (chunk, sink) => { lastSeen.set(name, Date.now()); sink.write(chunk); }; // any line = alive
  child.stdout.on("data", (c) => bump(c, process.stdout)); // children already tag their lines ([keeper] …)
  child.stderr.on("data", (c) => bump(c, process.stderr));
  child.on("exit", (code) => {
    console.error(`[drivers] ${name} exited (code ${code}) — restarting in 5s`);
    setTimeout(() => start(name), 5000);
  });
}
DRIVERS.forEach(start);
console.log(`[drivers] supervising: ${DRIVERS.join(", ")}`);

// Wedge watchdog: the exit handler above only reacts to a child that EXITS. A driver hung on an
// unresolved await stays "alive" and is never restarted — this silently froze M-ONIA prints for
// ~1h while agents kept bidding. If a child prints nothing for HEARTBEAT_MS, kill it; the exit
// handler restarts it. Every driver emits a line well within this window in normal operation
// (opens/closes/bids/prints), so a long silence means wedged. (waitTx now bounds admin sends —
// this is the general backstop for any remaining indefinite await.)
setInterval(() => {
  const now = Date.now();
  for (const name of DRIVERS) {
    const child = children.get(name);
    if (!child || child.exitCode !== null || child.signalCode) continue; // gone / already restarting
    const silent = now - (lastSeen.get(name) || now);
    if (silent > HEARTBEAT_MS) {
      console.error(`[drivers] ${name} silent ${Math.round(silent / 1000)}s (> ${Math.round(HEARTBEAT_MS / 1000)}s) — presumed wedged, restarting`);
      lastSeen.set(name, now); // don't re-kill before exit fires
      child.kill("SIGKILL");
    }
  }
}, 60 * 1000);

// Clean GitHub Actions handoff: the job has timeout-minutes 350. If GitHub CANCELS us at that mark
// a wedged runner can be slow to reap, and with concurrency cancel-in-progress:false the next
// scheduled run sits pending behind the zombie for up to an hour. Self-exit a bit EARLY instead, so
// the docker run ends cleanly and the next cron run takes over at once (the keeper's on-chain
// stall-guard, KEEPER_STALL_S, bridges the seam).
const MAX_RUNTIME_MS = Number(process.env.DRIVER_MAX_RUNTIME_MS || 340 * 60 * 1000); // 5h40m < 350m GH cap
setTimeout(() => {
  console.log(`[drivers] max runtime ${Math.round(MAX_RUNTIME_MS / 60000)}m reached — exiting cleanly for the next chained run`);
  process.exit(0);
}, MAX_RUNTIME_MS);

// While the market is being driven, keep the Render-hosted indexer/control warm —
// free-tier services spin down after 15 min without inbound traffic, and a judge's
// first paint shouldn't eat a cold start. Comma-separated URLs, optional.
const urls = (process.env.KEEPALIVE_URLS || "").split(",").map((s) => s.trim()).filter(Boolean);
if (urls.length) {
  const ping = () => Promise.all(urls.map((u) =>
    fetch(u, { signal: AbortSignal.timeout(90_000) }).catch(() => {}) // cold start / RPC flake — next round retries
  ));
  ping();
  setInterval(ping, 4 * 60 * 1000);
  console.log(`[drivers] keep-alive every 4m: ${urls.join(" ")}`);
}
