// Minimal browser shim for node's `assert`. circomlibjs' poseidon modules import it;
// our BabyJubJub path doesn't call it, but this guarantees no "assert is not a function"
// runtime fault if any dependency touches it in the browser.
function assert(cond: unknown, msg?: string): void {
  if (!cond) throw new Error(msg ?? 'assertion failed');
}
assert.ok = (cond: unknown, msg?: string) => assert(cond, msg);
assert.equal = (a: unknown, b: unknown, msg?: string) => assert(a == b, msg ?? `${a} != ${b}`);
assert.strictEqual = (a: unknown, b: unknown, msg?: string) => assert(a === b, msg ?? `${a} !== ${b}`);
assert.notEqual = (a: unknown, b: unknown, msg?: string) => assert(a != b, msg ?? `${a} == ${b}`);
assert.fail = (msg?: string) => assert(false, msg);

export default assert;
export { assert };
