// Runs the heavy chunked Groth16 M-ONIA print proof in a SEPARATE process, so the Control API's
// event loop stays free to answer /health during the (slow) proof on the constrained hosted
// instance (0.1 CPU / 512 MB). Without this, the synchronous proof blocks the loop past Render's
// 5s health check → the instance is SIGKILLed → crash loop. Invoked by POST /admin/print:
//   node services/lib/prove_worker.mjs <epoch>
// Emits exactly one sentinel-prefixed JSON line on stdout so the parent can parse past any
// library logging. Its memory (the proof) lives here, isolated from the Control process.
import "dotenv/config";
import { printEpoch } from "./adminops.mjs";
import { ADMIN_PK } from "./roles.mjs";

const SENTINEL = "__PRINT_RESULT__";
const epoch = Number(process.argv[2]);

try {
  const r = await printEpoch(ADMIN_PK, epoch);
  process.stdout.write("\n" + SENTINEL + JSON.stringify({ ok: true, ...r }) + "\n");
  process.exit(0);
} catch (e) {
  const error = e?.reason || e?.shortMessage || e?.message || String(e);
  process.stdout.write("\n" + SENTINEL + JSON.stringify({ ok: false, error }) + "\n");
  process.exit(1);
}
