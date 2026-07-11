import { describe, it, expect } from 'vitest';
import {
  parseUsdc,
  formatUsdc,
  formatUsdcCompact,
  belowMinBid,
  requiredCollateral,
  healthPct,
  microToNumber,
} from './usdc';

describe('usdc parse/format', () => {
  it('parses whole and fractional', () => {
    expect(parseUsdc('10')).toBe(10_000000n);
    expect(parseUsdc('1.5')).toBe(1_500000n);
    expect(parseUsdc('0.123456')).toBe(123456n);
  });
  it('truncates beyond 6 decimals', () => {
    expect(parseUsdc('0.1234567')).toBe(123456n);
  });
  it('handles empty / bare dot', () => {
    expect(parseUsdc('')).toBe(0n);
    expect(parseUsdc('.')).toBe(0n);
  });
  it('strips grouping commas', () => {
    expect(parseUsdc('1,234.50')).toBe(1_234_500000n);
  });
  it('throws on garbage', () => {
    expect(() => parseUsdc('abc')).toThrow();
  });
  it('formats grouped 2dp', () => {
    expect(formatUsdc(1_234_500000n)).toBe('1,234.50');
    expect(formatUsdc(10_000000n, { decimals: 0 })).toBe('10');
  });
  it('formats compact', () => {
    expect(formatUsdcCompact(1_500_000_000000n)).toBe('1.5M'); // 1.5M USDC
    expect(formatUsdcCompact(1_500_000000n)).toBe('1.5K'); // 1.5K USDC
    expect(formatUsdcCompact(2_500000n)).toBe('3'); // 2.5 USDC rounds
    expect(formatUsdcCompact(12_000_000_000000n)).toBe('12.0M'); // 12M USDC
  });
  it('microToNumber is display-only lossy convert', () => {
    expect(microToNumber(1_500000n)).toBe(1.5);
  });
});

describe('min-bid + collateral math', () => {
  it('enforces min bid per profile', () => {
    expect(belowMinBid(500000n, 'DEMO')).toBe(true); // < 1 USDC
    expect(belowMinBid(1_000000n, 'DEMO')).toBe(false);
    expect(belowMinBid(9_000000n, 'PROD')).toBe(true); // < 10 USDC
    expect(belowMinBid(10_000000n, 'PROD')).toBe(false);
  });
  it('computes 120% required collateral', () => {
    expect(requiredCollateral(100_000000n, 12_000)).toBe(120_000000n);
  });
  it('computes health %', () => {
    expect(healthPct(120_000000n, 100_000000n, 12_000)).toBe(100);
    expect(healthPct(150_000000n, 100_000000n, 12_000)).toBe(125);
    expect(healthPct(60_000000n, 100_000000n, 12_000)).toBe(50);
  });
});
