// Rate-tick math and uniform-price auction curve crossing.
import { RATE_MIN_BPS, RATE_MAX_BPS, TICK_BPS, TICK_COUNT } from '../config';
import type { Bps, DepthPoint, TickIndex, UsdcMicro } from './adapter/types';

export function tickToBps(tick: TickIndex): Bps {
  return RATE_MIN_BPS + tick * TICK_BPS;
}

export function bpsToTick(bps: Bps): TickIndex {
  return Math.round((bps - RATE_MIN_BPS) / TICK_BPS);
}

export function isValidTick(tick: TickIndex): boolean {
  return Number.isInteger(tick) && tick >= 0 && tick < TICK_COUNT;
}

/** "4.25%" from a bps value (100 bps = 1.00%). */
export function bpsToPctLabel(bps: Bps): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export interface TickMeta {
  tick: TickIndex;
  bps: Bps;
  label: string;
}
export function allTicks(): TickMeta[] {
  return Array.from({ length: TICK_COUNT }, (_, tick) => ({
    tick,
    bps: tickToBps(tick),
    label: bpsToPctLabel(tickToBps(tick)),
  }));
}

export interface CurvePoint {
  tick: TickIndex;
  bps: Bps;
  cumSupply: UsdcMicro; // asks accept rate >= r  → cumulative over ticks <= r (increasing)
  cumDemand: UsdcMicro; // bids accept rate <= r  → cumulative over ticks >= r (decreasing)
}

/**
 * Cumulative supply/demand from a per-tick depth curve.
 * Supply (lender asks: minimum acceptable rate) accumulates upward:  S(r) = Σ supply[t≤r].
 * Demand (borrower bids: maximum acceptable rate) accumulates downward: D(r) = Σ demand[t≥r].
 */
// Defensive: mock depth is bigint micro-USDC; live/indexer JSON may arrive as number|string.
// Coerce so `bigint += x` never throws and the chart degrades gracefully across adapters.
function toBig(v: unknown): bigint {
  if (typeof v === 'bigint') return v;
  if (v == null) return 0n;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? BigInt(n) : 0n;
}

export function cumulativeCurves(depth: DepthPoint[]): CurvePoint[] {
  const byTick = new Map<TickIndex, DepthPoint>();
  for (const d of depth) byTick.set(d.tick, d);

  // suffix demand (from high tick down)
  const demandSuffix: UsdcMicro[] = new Array(TICK_COUNT).fill(0n);
  let running = 0n;
  for (let t = TICK_COUNT - 1; t >= 0; t--) {
    running += toBig(byTick.get(t)?.demand);
    demandSuffix[t] = running;
  }

  const out: CurvePoint[] = [];
  let cumSupply = 0n;
  for (let t = 0; t < TICK_COUNT; t++) {
    cumSupply += toBig(byTick.get(t)?.supply);
    out.push({ tick: t, bps: tickToBps(t), cumSupply, cumDemand: demandSuffix[t] });
  }
  return out;
}

export interface Crossing {
  rStarTick: TickIndex | null;
  rStarBps: Bps | null;
  clearedVolume: UsdcMicro;
}

/**
 * Uniform-price crossing: lowest tick where cumulative supply ≥ cumulative demand
 * and a positive volume clears. Returns nulls (no-trade) if the curves never cross.
 * Tie-break = lowest crossing tick (Readme.md §3.4).
 */
export function selectCrossing(depth: DepthPoint[]): Crossing {
  const curve = cumulativeCurves(depth);
  for (const p of curve) {
    if (p.cumSupply >= p.cumDemand) {
      const cleared = p.cumDemand < p.cumSupply ? p.cumDemand : p.cumSupply; // min
      if (cleared > 0n) {
        return { rStarTick: p.tick, rStarBps: p.bps, clearedVolume: cleared };
      }
    }
  }
  return { rStarTick: null, rStarBps: null, clearedVolume: 0n };
}

export { RATE_MIN_BPS, RATE_MAX_BPS, TICK_BPS, TICK_COUNT };
