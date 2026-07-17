import { describe, it, expect } from 'vitest';
import { DemoEngine } from './adapter/mock/engine';
import { DEFAULT_SCENARIO } from './adapter/mock/scenarios';
import { TIME_PROFILES, timeProfile, minBidMicro } from '../config';
import type { EpochClock } from './adapter/types';

// Locks the DEMO/PROD profile wiring so the "toggle doesn't propagate" class of bug can't
// return: the mock clock and the label table must stay one source, and setProfile must re-pace
// AND re-emit the clock synchronously (labels are reactive via the store; the clock via this).
async function engine(p: 'DEMO' | 'PROD' = 'DEMO') {
  const e = new DemoEngine(p);
  await e.init(DEFAULT_SCENARIO.params, DEFAULT_SCENARIO.name);
  return e;
}

describe('profile wiring', () => {
  it('the mock clock and config labels share ONE timing table (no drift)', async () => {
    const e = await engine('DEMO');
    const c = e.getEpochClock();
    expect(c.epochLenMs).toBe(TIME_PROFILES.DEMO.epochLenMs);
    expect(c.tenorMs).toBe(TIME_PROFILES.DEMO.tenorMs);
    expect(c.profile).toBe('DEMO');
  });

  it('setProfile re-paces the clock to the new profile', async () => {
    const e = await engine('DEMO');
    e.setProfile('PROD');
    const c = e.getEpochClock();
    expect(c.profile).toBe('PROD');
    expect(c.epochLenMs).toBe(TIME_PROFILES.PROD.epochLenMs);
    expect(c.tenorMs).toBe(TIME_PROFILES.PROD.tenorMs);
  });

  it('setProfile emits the re-paced clock to subscribers synchronously', async () => {
    const e = await engine('DEMO');
    const seen: EpochClock[] = [];
    e.subscribeClock((c) => seen.push(c)); // fires once immediately with DEMO
    seen.length = 0;
    e.setProfile('PROD');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1].profile).toBe('PROD');
    expect(seen[seen.length - 1].epochLenMs).toBe(TIME_PROFILES.PROD.epochLenMs);
  });

  it('profile-derived labels and min-bid actually differ by profile', () => {
    expect(timeProfile('DEMO').tenorLabel).not.toBe(timeProfile('PROD').tenorLabel);
    expect(timeProfile('DEMO').epochLabel).not.toBe(timeProfile('PROD').epochLabel);
    expect(minBidMicro('DEMO')).toBe(1_000000n); // 1 USDC in DEMO
    expect(minBidMicro('PROD')).toBe(10_000000n); // 10 USDC in PROD
    expect(minBidMicro('DEMO')).not.toBe(minBidMicro('PROD'));
  });
});
