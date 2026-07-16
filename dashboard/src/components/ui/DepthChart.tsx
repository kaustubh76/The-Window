import { useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ReferenceDot,
  Tooltip,
} from 'recharts';
import type { DepthPoint, Side, TickIndex } from '../../lib/adapter/types';
import { cumulativeCurves, selectCrossing, tickToBps, bpsToTick } from '../../lib/rates';
import { microToNumber, formatUsdcCompact } from '../../lib/usdc';
import { ChartLegend } from './ChartLegend';

// Aggregate depth curve (admin-published, PoCD-backed): cumulative supply vs demand,
// crossing at the clearing rate r*. Amounts here are the ONLY size data shown publicly.
// Interactive extras (all optional — read-only when absent): click a point to pick a rate,
// a "your rate" line, and a ghost dot showing where your order lands on the curve.
export function DepthChart({
  depth,
  height = 260,
  onPickRate,
  selectedTick = null,
  orderSize,
  side,
}: {
  depth: DepthPoint[];
  height?: number;
  onPickRate?: (tick: TickIndex) => void;
  selectedTick?: TickIndex | null;
  orderSize?: bigint;
  side?: Side;
}) {
  const { data, rStarPct, hasData } = useMemo(() => {
    const curve = cumulativeCurves(depth);
    const rows = curve.map((p) => ({
      pct: p.bps / 100,
      supply: microToNumber(p.cumSupply),
      demand: microToNumber(p.cumDemand),
    }));
    const x = selectCrossing(depth);
    return {
      data: rows,
      rStarPct: x.rStarBps !== null ? x.rStarBps / 100 : null,
      hasData: depth.some((d) => d.supply > 0n || d.demand > 0n),
    };
  }, [depth]);

  // "Your order" overlay: place a ghost dot at the selected rate, stacked on the cumulative
  // depth of the relevant side so it reads as "this is where my order sits".
  const ghost = useMemo(() => {
    if (selectedTick == null) return null;
    const pct = tickToBps(selectedTick) / 100;
    const row = data.find((r) => Math.abs(r.pct - pct) < 0.001);
    const base = row ? (side === 'ask' ? row.supply : row.demand) : 0;
    const sizeUsdc = orderSize != null ? microToNumber(orderSize) : 0;
    return { pct, y: base + sizeUsdc, hasSize: sizeUsdc > 0 };
  }, [selectedTick, data, orderSize, side]);

  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 text-sm text-gray-600" style={{ height }}>
        <span className="inline-flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-cipher-500 animate-pulse-soft" />
          No bids yet this epoch — encrypted orders are streaming in…
        </span>
      </div>
    );
  }

  const interactive = !!onPickRate;
  const handleClick = (state: { activeLabel?: string | number } | null) => {
    if (!onPickRate || state?.activeLabel == null) return;
    const bps = Number(state.activeLabel) * 100;
    if (Number.isFinite(bps)) onPickRate(bpsToTick(bps));
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <ChartLegend />
        {interactive && <span className="text-[10px] text-gray-600">click the curve to set your rate</span>}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 12, bottom: 4, left: -8 }}
          onClick={interactive ? handleClick : undefined}
          className={interactive ? 'cursor-pointer' : undefined}
        >
        <defs>
          <linearGradient id="supplyFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#12B5CE" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#12B5CE" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="demandFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F5A300" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#F5A300" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis
          dataKey="pct"
          type="number"
          domain={[1, 10]}
          ticks={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
          tickFormatter={(v) => `${v}%`}
          tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          stroke="rgba(255,255,255,0.08)"
        />
        <YAxis
          tickFormatter={(v) => formatUsdcCompact(BigInt(Math.round(v)) * 1_000000n)}
          tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          stroke="rgba(255,255,255,0.08)"
          width={44}
        />
        <Tooltip
          cursor={interactive ? { stroke: '#F5A300', strokeDasharray: '3 3', strokeOpacity: 0.6 } : undefined}
          contentStyle={{
            background: '#0d0f14',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12,
            fontSize: 12,
          }}
          labelFormatter={(v) => `Rate ${Number(v).toFixed(2)}%`}
          formatter={(value: number, name: string) => [`${formatUsdcCompact(BigInt(Math.round(value)) * 1_000000n)} USDC`, name === 'supply' ? 'Supply (asks)' : 'Demand (bids)']}
        />
        <Area
          type="stepAfter"
          dataKey="supply"
          stroke="#12B5CE"
          strokeWidth={2}
          fill="url(#supplyFill)"
          isAnimationActive={false}
          name="supply"
        />
        <Area
          type="stepBefore"
          dataKey="demand"
          stroke="#F5A300"
          strokeWidth={2}
          fill="url(#demandFill)"
          isAnimationActive={false}
          name="demand"
        />
        {rStarPct !== null && (
          <ReferenceLine
            x={rStarPct}
            stroke="#ffffff"
            strokeDasharray="4 4"
            strokeOpacity={0.6}
            label={{ value: `r* ${rStarPct.toFixed(2)}%`, fill: '#F5A300', fontSize: 11, position: 'top' }}
          />
        )}
        {/* your selected rate */}
        {ghost && (
          <ReferenceLine
            x={ghost.pct}
            stroke="#F5A300"
            strokeWidth={1.5}
            strokeOpacity={0.9}
            label={{ value: 'you', fill: '#F5A300', fontSize: 10, position: 'insideTopRight' }}
          />
        )}
        {/* ghost of where your order lands on the curve */}
        {ghost && ghost.hasSize && (
          <ReferenceDot x={ghost.pct} y={ghost.y} r={5} fill="#F5A300" stroke="#0d0f14" strokeWidth={2} isFront />
        )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
