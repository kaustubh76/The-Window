// Prove the eERC wrap -> reveal -> unwrap round-trip works for a REALISTIC amount.
// Before the BSGS-range fix (memberops BALANCE_BSGS_MAX), reveal silently returned null and
// unwrap 400'd for any balance above ~$1.05 (1<<20 micro). This wraps $100 and asserts the
// encrypted balance decrypts to exactly the wrapped delta, then unwraps and confirms it clears.
// Run:  CONTROL_URL=https://window-control.onrender.com ACTOR=lender1 node demo/verify_wrap_reveal.mjs
const CONTROL = process.env.CONTROL_URL || "http://127.0.0.1:8899";
const ACTOR = process.env.ACTOR || "lender1";
const N_MICRO = 100_000000n; // wrap $100 — comfortably past the old $1.05 BSGS ceiling

async function post(path, body) {
  const r = await fetch(`${CONTROL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}
async function balance() {
  // resolve the actor address, then read its balance (eercClear = decrypted micro-USDC or null)
  const actors = await (await fetch(`${CONTROL}/actors`)).json();
  const a = actors.find((x) => x.name === ACTOR);
  if (!a) throw new Error(`unknown actor ${ACTOR}`);
  const b = await (await fetch(`${CONTROL}/member/balance/${a.address}`)).json();
  return { addr: a.address, usdc: BigInt(b.usdc ?? 0), eercClear: b.eercClear == null ? null : BigInt(b.eercClear) };
}

let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };

console.log(`wrap/reveal verify on ${CONTROL} as ${ACTOR}\n`);

// register (idempotent) so the eERC balance exists, then snapshot
await post("/member/register", { actor: ACTOR }).catch(() => {});
const before = await balance();
console.log(`  before: usdc=${before.usdc} eercClear=${before.eercClear}`);

// ensure enough public TestUSDC to wrap, then wrap $100
await post("/member/faucet", { actor: ACTOR, amount: (N_MICRO * 2n).toString() });
const wrapRes = await post("/member/wrap", { actor: ACTOR, amount: N_MICRO.toString() });
check(wrapRes.ok !== false, `wrap $100 accepted (tx ${wrapRes.txHash ?? wrapRes.error})`);

// THE FIX: the encrypted balance must now reveal (non-null) and equal the wrapped delta.
const after = await balance();
console.log(`  after:  usdc=${after.usdc} eercClear=${after.eercClear}`);
check(after.eercClear != null, `encrypted balance REVEALS after wrapping $100 (was null pre-fix)`);
if (after.eercClear != null && before.eercClear != null) {
  check(after.eercClear - before.eercClear === N_MICRO, `revealed delta == $100 (${after.eercClear - before.eercClear} micro)`);
} else {
  check(after.eercClear != null && after.eercClear >= N_MICRO, `revealed balance >= $100 (${after.eercClear} micro)`);
}

// unwrap must succeed (pre-fix it threw building the withdraw proof from an undecryptable balance)
const unwrapRes = await post("/member/unwrap", { actor: ACTOR, amount: N_MICRO.toString() });
check(unwrapRes.ok !== false, `unwrap $100 accepted (tx ${unwrapRes.txHash ?? unwrapRes.error})`);

console.log(
  failures === 0
    ? "\nWRAP/REVEAL VERIFY: PASS — encrypted deposits reveal and unwrap for real amounts"
    : `\nWRAP/REVEAL VERIFY: ${failures} FAILURE(S) (is the Control API up at ${CONTROL}?)`,
);
process.exit(failures === 0 ? 0 : 1);
