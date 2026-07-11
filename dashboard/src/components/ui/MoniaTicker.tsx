import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import type { MoniaPrint } from '../../lib/adapter/types';
import { formatUsdcCompact } from '../../lib/usdc';
import { useAnimatedNumber } from '../../hooks/useAnimatedNumber';
import { PoCDBadge } from './PoCDBadge';
import { MoniaSparkline } from './MoniaSparkline';

// The hero number. Big gold M-ONIA rate (animated odometer + per-print entrance) + delta
// + PoCD + stale flag + sparkline.
export function MoniaTicker({ latest, history }: { latest: MoniaPrint | null; history: MoniaPrint[] }) {
  const rate = latest?.rStarBps ?? null;
  const series = history.map((p) => p.rStarBps);
  const animated = useAnimatedNumber(rate ?? 0);

  // delta vs the previous distinct printed rate
  const printed = history.filter((p) => p.rStarBps !== null);
  const prev = printed.length >= 2 ? printed[printed.length - 2].rStarBps : null;
  const delta = rate !== null && prev !== null ? rate - prev : 0;
  const DeltaIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const deltaColor = delta > 0 ? 'text-signal-down' : delta < 0 ? 'text-signal-up' : 'text-gray-500';
  // note: a higher borrowing rate is "worse" for borrowers → red up, green down (rate terms)

  return (
    <div className="relative">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-gray-500 mb-2">
            M-ONIA
            <span className="text-gray-700">·</span>
            <span className="text-gray-500">Machine Overnight Index Average</span>
          </div>
          <div className="flex items-end gap-3">
            <span
              className="rate-print text-6xl sm:text-7xl leading-none animate-ticker-in inline-block tabular-nums"
              key={latest?.epoch ?? 'none'}
            >
              {rate !== null ? `${(animated / 100).toFixed(2)}%` : '—'}
            </span>
            {rate !== null && prev !== null && (
              <span className={clsx('flex items-center gap-1 num text-sm font-semibold mb-2', deltaColor)}>
                <DeltaIcon className="w-4 h-4" />
                {delta === 0 ? '0' : `${delta > 0 ? '+' : ''}${delta}bps`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-3">
            {latest && <PoCDBadge pocd={latest.pocd} />}
            {latest?.stale && (
              <span className="pill num bg-signal-stale/12 text-signal-stale border border-signal-stale/25">
                <AlertTriangle className="w-3 h-3" /> stale · no-trade
              </span>
            )}
            {latest && (
              <span className="text-xs text-gray-500 num">
                vol {formatUsdcCompact(latest.aggVolume)} · epoch {latest.epoch}
              </span>
            )}
          </div>
        </div>
        <div className="pt-2">
          <MoniaSparkline values={series} width={200} height={56} />
        </div>
      </div>
    </div>
  );
}
