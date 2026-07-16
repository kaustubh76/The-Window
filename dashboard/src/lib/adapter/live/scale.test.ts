import { describe, it, expect } from 'vitest';
import { mapPrint, mapDepth, eercToMicro, microToEercUnit, EERC_UNIT_MICRO } from './LiveAdapter';
import { formatUsdcCompact, formatVolume, parseUsdc } from '../../usdc';

// The live indexer serves the auction world (bid size → depth → aggVolume) as bare whole-USDC
// integers (BSGS-decryptable scalars). The frontend money layer is micro-USDC. These tests pin
// the ×1e6 read-in / ÷1e6 write-out translation so "Epoch volume" can never silently read $0.

// A real /monia/latest shape captured from window-indexer.onrender.com (epoch 1263).
const LIVE_PRINT = {
  epoch: 1263,
  rStarBps: 375,
  aggVolume: '673',
  depth: [
    { tick: 7, bps: 275, supply: '394', demand: '0' },
    { tick: 11, bps: 375, supply: '595', demand: '0' },
    { tick: 14, bps: 450, supply: '0', demand: '152' },
  ],
  pocd: { verified: true },
  printedAt: 1784224913000,
  stale: false,
};

describe('live auction unit scaling', () => {
  it('scales whole-USDC aggVolume to micro-USDC', () => {
    const p = mapPrint(LIVE_PRINT)!;
    expect(p.aggVolume).toBe(673_000000n); // 673 USDC, not 673 micro
  });

  it('scales depth supply/demand to micro-USDC', () => {
    const d = mapDepth(LIVE_PRINT.depth);
    expect(d[0].supply).toBe(394_000000n);
    expect(d[1].supply).toBe(595_000000n);
    expect(d[2].demand).toBe(152_000000n);
  });

  it('the scaled volume renders as real USDC — never "0"', () => {
    const p = mapPrint(LIVE_PRINT)!;
    expect(formatUsdcCompact(p.aggVolume)).toBe('673');
    expect(formatUsdcCompact(p.aggVolume)).not.toBe('0');
  });

  it('formatVolume shows the figure for a traded print and "—" for no-trade/stale', () => {
    expect(formatVolume(mapPrint(LIVE_PRINT)!)).toBe('673');
    expect(formatVolume({ aggVolume: 0n })).toBe('—');
    expect(formatVolume({ aggVolume: 673_000000n, stale: true })).toBe('—');
  });

  it('bid size round-trips micro → whole-USDC for the on-chain scalar', () => {
    // A 500 USDC UI bid must post the small scalar "500", staying in BSGS range.
    expect(microToEercUnit(parseUsdc('500'))).toBe('500');
    expect(microToEercUnit(parseUsdc('1'))).toBe('1'); // min bid
    expect(EERC_UNIT_MICRO).toBe(1_000_000n);
  });

  it('boundary helpers are null/garbage-safe', () => {
    expect(eercToMicro(null)).toBe(0n);
    expect(eercToMicro('0')).toBe(0n);
    expect(mapPrint(null)).toBeNull();
    expect(mapDepth(undefined)).toEqual([]);
  });
});
