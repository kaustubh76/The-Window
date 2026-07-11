import { describe, it, expect } from 'vitest';
import { DemoEngine } from './engine';
import { DEFAULT_SCENARIO } from './scenarios';

async function freshEngine() {
  const e = new DemoEngine('DEMO');
  await e.init(DEFAULT_SCENARIO.params, DEFAULT_SCENARIO.name);
  return e;
}

describe('DemoEngine', () => {
  it('prints M-ONIA after the first epoch, with a verified PoCD', async () => {
    const e = await freshEngine();
    const L = e.getEpochClock().epochLenMs;
    e.seek(L); // past epoch 0's print (0.88 * L)
    const hist = e.getMoniaHistory();
    expect(hist.length).toBeGreaterThanOrEqual(1);
    expect(hist[0].pocd.verified).toBe(true);
    // r* is either a valid 25bps tick in band, or null (no-trade)
    const r = hist[0].rStarBps;
    if (r !== null) {
      expect(r).toBeGreaterThanOrEqual(100);
      expect(r).toBeLessThanOrEqual(1000);
      expect(r % 25).toBe(0);
    }
  });

  it('emits genuine per-tick ciphertexts for epoch 0', async () => {
    const e = await freshEngine();
    e.seek(e.getEpochClock().epochLenMs * 0.8);
    expect(e.getRawCiphertexts(0).length).toBeGreaterThan(0);
  });

  it('cycles loans through the book over several epochs', async () => {
    const e = await freshEngine();
    e.seek(e.getEpochClock().epochLenMs * 6);
    const loans = e.getLoanBook();
    expect(loans.length).toBeGreaterThan(0);
    const statuses = new Set(loans.map((l) => l.status));
    expect([...statuses].some((s) => s === 'Repaid' || s === 'Active' || s === 'Defaulted')).toBe(true);
  });

  it('is deterministic — same seed yields the same first print', async () => {
    const a = await freshEngine();
    const b = await freshEngine();
    const L = a.getEpochClock().epochLenMs;
    a.seek(L);
    b.seek(L);
    expect(b.getMoniaHistory()[0].rStarBps).toBe(a.getMoniaHistory()[0].rStarBps);
    expect(b.getRawCiphertexts(0)[0].agg.c1[0]).toBe(a.getRawCiphertexts(0)[0].agg.c1[0]);
  });

  it('scrubbing back and forward reproduces identical state (deterministic replay)', async () => {
    const e = await freshEngine();
    const L = e.getEpochClock().epochLenMs;
    e.seek(L * 3);
    const before = e.getMoniaHistory().map((p) => p.rStarBps);
    e.seek(0);
    expect(e.getMoniaHistory().length).toBe(0);
    e.seek(L * 3);
    const after = e.getMoniaHistory().map((p) => p.rStarBps);
    expect(after).toEqual(before);
  });
});
