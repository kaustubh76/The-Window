import { describe, it, expect } from 'vitest';
import { easeOutCubic } from './useAnimatedNumber';

describe('easeOutCubic', () => {
  it('maps endpoints and midpoint', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 5);
  });
  it('is monotonically non-decreasing across [0,1]', () => {
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = easeOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
