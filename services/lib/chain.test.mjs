// Unit tests for waitTx — the timeout guard that stops a dropped/underpriced Fuji tx from hanging
// a driver's single-threaded loop forever. Run: `npm test` (node --test) from services/.
import test from "node:test";
import assert from "node:assert/strict";
import { waitTx } from "./chain.mjs";

test("rejects when the tx never mines (wait() hangs)", async () => {
  const neverMines = { hash: "0xdead", wait: () => new Promise(() => {}) };
  await assert.rejects(
    waitTx(neverMines, { timeoutMs: 50, label: "stuck" }),
    /stuck not mined in/,
  );
});

test("rejects when the send itself never resolves", async () => {
  const hangingSend = new Promise(() => {}); // contract.method() that never returns a TransactionResponse
  await assert.rejects(
    waitTx(hangingSend, { timeoutMs: 50, label: "send" }),
    /not mined in/,
  );
});

test("returns { rc, tx } on success and passes confirmations through", async () => {
  const rc = { gasUsed: 21000n, blockNumber: 7 };
  let sawConfs;
  const tx = { hash: "0xabc", wait: async (c) => { sawConfs = c; return rc; } };
  const out = await waitTx(tx, { timeoutMs: 1000, confirmations: 2, label: "ok" });
  assert.equal(out.tx, tx);
  assert.equal(out.rc, rc);
  assert.equal(sawConfs, 2);
});

test("clears its timer on success (no lingering timeout keeps the loop alive)", async () => {
  // If clearTimeout weren't called, this test file would hang ~60s before the runner could exit.
  const tx = { hash: "0x1", wait: async () => ({ ok: true }) };
  const out = await waitTx(tx, { timeoutMs: 60_000 });
  assert.equal(out.rc.ok, true);
});
