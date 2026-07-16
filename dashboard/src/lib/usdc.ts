// Money helpers — everything in bigint micro-USDC (6 decimals). Format only at render.
import { formatUnits, parseUnits } from 'viem';
import { USDC_DECIMALS, minBidMicro, type Profile } from '../config';
import type { UsdcMicro } from './adapter/types';

// Defensive: the live indexer/control serialize uint256 as decimal strings. The adapter
// normalizes to bigint, but coerce here too so no render path ever does `string * bigint`.
function toMicro(v: unknown): bigint {
  if (typeof v === 'bigint') return v;
  if (v == null) return 0n;
  try {
    return BigInt(typeof v === 'number' ? Math.trunc(v) : String(v).split('.')[0] || '0');
  } catch {
    return 0n;
  }
}

/** Parse a user-entered decimal string ("12.5") to micro-USDC. Throws on garbage. */
export function parseUsdc(input: string): UsdcMicro {
  const cleaned = input.trim().replace(/,/g, '');
  if (cleaned === '' || cleaned === '.') return 0n;
  if (!/^\d*\.?\d*$/.test(cleaned)) throw new Error('Invalid amount');
  // clamp fractional digits to 6 to avoid parseUnits throwing
  const [whole, frac = ''] = cleaned.split('.');
  const safeFrac = frac.slice(0, USDC_DECIMALS);
  return parseUnits(`${whole || '0'}.${safeFrac}`, USDC_DECIMALS);
}

/** Format micro-USDC to a grouped decimal string, e.g. 1234500000n -> "1,234.50". */
export function formatUsdc(micro: UsdcMicro, opts: { decimals?: number; group?: boolean } = {}): string {
  const { decimals = 2, group = true } = opts;
  const raw = formatUnits(toMicro(micro), USDC_DECIMALS); // e.g. "1234.5"
  const [whole, frac = ''] = raw.split('.');
  const fixedFrac = (frac + '0'.repeat(decimals)).slice(0, decimals);
  const groupedWhole = group ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole;
  return decimals > 0 ? `${groupedWhole}.${fixedFrac}` : groupedWhole;
}

/** Epoch-volume label: em dash for a no-trade / stale print (no volume actually cleared),
 *  else compact USDC. Keeps "no trade" from reading as a misleading "$0". */
export function formatVolume(v: { aggVolume: UsdcMicro; stale?: boolean }): string {
  return v.stale || toMicro(v.aggVolume) === 0n ? '—' : formatUsdcCompact(v.aggVolume);
}

/** Compact form for charts/tickers: 1_500_000000n -> "1.5M". */
export function formatUsdcCompact(micro: UsdcMicro): string {
  const n = microToNumber(micro);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

/** Lossy conversion to a JS number — ONLY for chart coordinates / display, never for math. */
export function microToNumber(micro: UsdcMicro): number {
  return Number(formatUnits(toMicro(micro), USDC_DECIMALS));
}

export function belowMinBid(micro: UsdcMicro, profile: Profile): boolean {
  return toMicro(micro) < minBidMicro(profile);
}

export function addMicro(...xs: UsdcMicro[]): UsdcMicro {
  return xs.reduce((a, b) => a + b, 0n);
}

/** Collateral required for a loan at the fixed 120% haircut. */
export function requiredCollateral(loanSize: UsdcMicro, haircutBps: number): UsdcMicro {
  return (toMicro(loanSize) * BigInt(haircutBps)) / 10_000n;
}

/** Health % of a collateral vs loan pair against the haircut (100% = exactly at haircut). */
export function healthPct(collateral: UsdcMicro, loanSize: UsdcMicro, haircutBps: number): number {
  if (loanSize === 0n) return 0;
  const required = requiredCollateral(loanSize, haircutBps);
  if (required === 0n) return 0;
  return Math.round(microToNumber(collateral) / microToNumber(required) * 100);
}
