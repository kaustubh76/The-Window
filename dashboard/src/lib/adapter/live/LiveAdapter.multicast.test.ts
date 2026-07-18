// Regression test for the /epoch/clock request flood (ERR_INSUFFICIENT_RESOURCES):
// subscribeClock/subscribe must MULTICAST one fetch loop to all subscribers — a
// per-subscriber interval scaled O(rendered loan rows) and flooded the browser.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../services/indexer', () => ({
  IndexerAPI: {
    epochClock: vi.fn(async () => ({
      epoch: 5, status: 'Open', openedAt: 0, closesAt: 0, epochLenMs: 120_000,
      tenorMs: 0, now: 123, profile: 'DEMO',
    })),
    events: vi.fn(async () => []),
  },
}));

import { LiveAdapter } from './LiveAdapter';
import { IndexerAPI } from '../../../services/indexer';

const clockFetches = () => (IndexerAPI.epochClock as ReturnType<typeof vi.fn>).mock.calls.length;
const eventFetches = () => (IndexerAPI.events as ReturnType<typeof vi.fn>).mock.calls.length;

describe('LiveAdapter multicast pollers', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
  afterEach(() => { vi.useRealTimers(); });

  it('50 clock subscribers share ONE fetch per tick (not 50)', async () => {
    const a = new LiveAdapter();
    const seen = Array.from({ length: 50 }, () => vi.fn());
    const unsubs = seen.map((cb) => a.subscribeClock(cb));

    await vi.advanceTimersByTimeAsync(3_000); // initial fetch + 3 ticks
    expect(clockFetches()).toBeLessThanOrEqual(4);
    expect(clockFetches()).toBeGreaterThanOrEqual(3);
    for (const cb of seen) expect(cb).toHaveBeenCalled(); // every subscriber fed
    expect(seen[0].mock.calls[0][0].epoch).toBe(5);

    unsubs.forEach((u) => u());
    const after = clockFetches();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(clockFetches()).toBeLessThanOrEqual(after + 1); // loop stops when empty
  });

  it('clock loop does not overlap itself when the backend is slow', async () => {
    (IndexerAPI.epochClock as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((r) => setTimeout(() => r({
        epoch: 5, status: 'Open', openedAt: 0, closesAt: 0, epochLenMs: 120_000,
        tenorMs: 0, now: 123, profile: 'DEMO',
      }), 10_000)), // 10s per response — slower than the 1s cadence
    );
    const a = new LiveAdapter();
    const un = a.subscribeClock(vi.fn());
    await vi.advanceTimersByTimeAsync(30_000);
    // self-scheduling: at most ceil(30s / (10s fetch + 1s gap)) ≈ 3 in flight-serial
    // fetches — the old setInterval fired 30 overlapping ones
    expect(clockFetches()).toBeLessThanOrEqual(4);
    un();
  });

  it('event subscribers share one loop and every subscriber sees every event', async () => {
    (IndexerAPI.events as ReturnType<typeof vi.fn>).mockResolvedValue([
      { type: 'EpochOpened', epoch: 7, block: 100, txHash: '0xabc' },
    ]);
    const a = new LiveAdapter();
    const s1 = vi.fn(); const s2 = vi.fn();
    const u1 = a.subscribe(s1); const u2 = a.subscribe(s2);
    await vi.advanceTimersByTimeAsync(2_100);
    expect(eventFetches()).toBeLessThanOrEqual(2); // one loop, not one per subscriber
    expect(s1).toHaveBeenCalled();
    expect(s2).toHaveBeenCalled(); // old per-subscriber loops split events between subs
    u1(); u2();
  });
});
