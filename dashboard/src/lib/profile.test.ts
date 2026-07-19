import { describe, it, expect } from 'vitest';
import { timeProfile, minBidMicro } from '../config';

// Locks the DEMO/PROD profile wiring: labels and min-bid must stay one source
// (config TIME_PROFILES) so the live ProfileSwitch can't drift from the copy.
describe('profile config', () => {
  it('profile-derived labels and min-bid actually differ by profile', () => {
    expect(timeProfile('DEMO').tenorLabel).not.toBe(timeProfile('PROD').tenorLabel);
    expect(timeProfile('DEMO').epochLabel).not.toBe(timeProfile('PROD').epochLabel);
    expect(minBidMicro('DEMO')).toBe(1_000000n); // 1 USDC in DEMO
    expect(minBidMicro('PROD')).toBe(10_000000n); // 10 USDC in PROD
    expect(minBidMicro('DEMO')).not.toBe(minBidMicro('PROD'));
  });
});
