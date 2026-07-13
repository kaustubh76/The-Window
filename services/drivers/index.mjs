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

function start(name) {
  const child = spawn("node", [`${name}/index.mjs`], { cwd: SERVICES, env: process.env });
  child.stdout.pipe(process.stdout); // children already tag their lines ([keeper] …)
  child.stderr.pipe(process.stderr);
  child.on("exit", (code) => {
    console.error(`[drivers] ${name} exited (code ${code}) — restarting in 5s`);
    setTimeout(() => start(name), 5000);
  });
}
DRIVERS.forEach(start);
console.log(`[drivers] supervising: ${DRIVERS.join(", ")}`);

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
