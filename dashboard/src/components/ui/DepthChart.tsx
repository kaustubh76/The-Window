import { useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
} from 'recharts';
import type { DepthPoint } from '../../lib/adapter/types';
import { cumulativeCurves, selectCrossing } from '../../lib/rates';
import { microToNumber, formatUsdcCompact } from '../../lib/usdc';
import { ChartLegend } from './ChartLegend';

// Aggregate depth curve (admin-published, PoCD-backed): cumulative supply vs demand,
// crossing at the clearing rate r*. Amounts here are the ONLY size data shown publicly.
export function DepthChart({ depth, height = 260 }: { depth: DepthPoint[]; height?: number }) {
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

  return (
    <div>
      <ChartLegend />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
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
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
