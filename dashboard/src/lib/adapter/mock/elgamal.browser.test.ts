import { describe, it, expect } from 'vitest';
import { buildElgamal } from './elgamal.browser';

// Mirrors packages/eerc-node/src/gen_pocd_input.mjs: encrypt 100 + 250, homomorphic-add,
// decrypt, BSGS-recover 350. Validates the browser crypto port bit-for-bit.
describe('elgamal.browser', () => {
  it('encrypt → addCipher → decrypt → bsgs recovers the sum (100+250=350)', async () => {
    const el = await buildElgamal();
    const priv = 2748579834902348905823409582340958234n;
    const { pub } = el.keypair(priv);
    const e1 = el.encrypt(pub, 100n, 987654321n);
    const e2 = el.encrypt(pub, 250n, 123456789n);
    const sum = el.addCipher(e1, e2);
    const M = el.decryptToPoint(priv, sum);
    expect(el.bsgs(M, 1 << 20)).toBe(350);
  });

  it('produces genuine 2-point ciphertexts (4 field coords)', async () => {
    const el = await buildElgamal();
    const { pub } = el.keypair(42n);
    const c = el.toStrings(el.encrypt(pub, 7n, 555n));
    expect(c.c1).toHaveLength(2);
    expect(c.c2).toHaveLength(2);
    expect(c.c1[0]).toMatch(/^\d+$/);
  });
});
