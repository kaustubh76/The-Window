// BSGS discrete-log tests — guards the balance-decrypt fix: the table is now cached and reused, and
// an async yielding variant runs on the hosted control so a decrypt can't block /health. These must
// stay byte-for-byte equivalent to the original synchronous decrypt. Run: `node --test` here.
import test from "node:test";
import assert from "node:assert/strict";
import { Base8, mulPointEscalar } from "@zk-kit/baby-jubjub";
import { bsgs, bsgsAsync, buildBabyTableAsync } from "./eerc.mjs";

const MAX = 2 ** 31; // BALANCE_BSGS_MAX
const point = (v) => mulPointEscalar(Base8, BigInt(v)).map(BigInt); // M = v·G, so bsgs(M) must be v

// Representative micro-USDC balances (6dp): 0, dust, $1, $500, ~$2000 — all under the 2**31 ceiling.
const VALUES = [0, 1, 42, 1_000000, 500_000000, 2_000_000000];

test("sync bsgs round-trips the scalar (correctness preserved after table refactor)", () => {
  for (const v of VALUES) assert.equal(bsgs(point(v), MAX), BigInt(v), `v=${v}`);
});

test("async bsgs equals sync bsgs and the plaintext (yielding changes scheduling, not the result)", async () => {
  for (const v of VALUES) {
    const a = await bsgsAsync(point(v), MAX);
    assert.equal(a, bsgs(point(v), MAX));
    assert.equal(a, BigInt(v), `v=${v}`);
  }
});

test("baby-step table is built once and reused (same cached object)", async () => {
  const t1 = await buildBabyTableAsync(MAX);
  const t2 = await buildBabyTableAsync(MAX);
  assert.equal(t1, t2);
});
