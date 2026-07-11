import { describe, it, expect } from 'vitest';
import { tickToBps, bpsToTick, allTicks, bpsToPctLabel, selectCrossing, cumulativeCurves } from './rates';
import type { DepthPoint } from './adapter/types';

const dp = (tick: number, supply: bigint, demand: bigint): DepthPoint => ({
  tick,
  bps: tickToBps(tick),
  supply,
  demand,
});

describe('tick math', () => {
  it('maps ticks to bps across the 1%-10% band', () => {
    expect(tickToBps(0)).toBe(100);
    expect(tickToBps(36)).toBe(1000);
    expect(bpsToTick(100)).toBe(0);
    expect(bpsToTick(1000)).toBe(36);
  });
  it('has 37 ticks', () => {
    expect(allTicks()).toHaveLength(37);
  });
  it('labels bps as percent', () => {
    expect(bpsToPctLabel(425)).toBe('4.25%');
    expect(bpsToPctLabel(431)).toBe('4.31%');
  });
});

describe('uniform-price crossing', () => {
  it('crosses at the lowest tick where supply >= demand', () => {
    // lender asks min 3.00% (tick 8), borrower bids max 5.00% (tick 16)
    const depth = [dp(8, 500_000000n, 0n), dp(16, 0n, 400_000000n)];
    const x = selectCrossing(depth);
    expect(x.rStarBps).toBe(300);
    expect(x.rStarTick).toBe(8);
    expect(x.clearedVolume).toBe(400_000000n);
  });

  it('returns no-trade when curves do not overlap', () => {
    // lender min 6.00% (tick 20), borrower max 3.00% (tick 8) — no overlap
    const depth = [dp(20, 500_000000n, 0n), dp(8, 0n, 400_000000n)];
    const x = selectCrossing(depth);
    expect(x.rStarBps).toBeNull();
    expect(x.rStarTick).toBeNull();
    expect(x.clearedVolume).toBe(0n);
  });

  it('cumulative supply increases, demand decreases', () => {
    const depth = [dp(4, 100_000000n, 0n), dp(8, 200_000000n, 0n), dp(16, 0n, 400_000000n)];
    const curve = cumulativeCurves(depth);
    expect(curve[4].cumSupply).toBe(100_000000n);
    expect(curve[8].cumSupply).toBe(300_000000n);
    expect(curve[0].cumDemand).toBe(400_000000n); // all demand visible at low rate
    expect(curve[36].cumDemand).toBe(0n);
  });
});
