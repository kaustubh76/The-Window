import { useMemo } from 'react';
import clsx from 'clsx';
import type { DepthPoint, TickIndex } from '../../lib/adapter/types';
import { selectCrossing, tickToBps, bpsToPctLabel } from '../../lib/rates';
import { microToNumber, formatUsdcCompact } from '../../lib/usdc';

// Per-tick bid/ask depth ladder — the tabular twin of DepthChart. Supply (lender asks, cyan)
// vs demand (borrower bids, gold) at each rate tick, with the clearing rate r* highlighted.
// These aggregate, PoCD-backed sizes are the only size data shown publicly (individual bids
// stay ciphertext). Rows are click-to-trade when onPickRate is provided.
export function DepthLadder({
  depth,
  onPickRate,
}: {
  depth: DepthPoint[];
  onPickRate?: (tick: TickIndex) => void;
}) {
  const { rows, rStarTick, max } = useMemo(() => {
    const active = depth
      .filter((d) => d.supply > 0n || d.demand > 0n)
      .sort((a, b) => a.tick - b.tick);
    const x = selectCrossing(depth);
    const m = active.reduce((acc, d) => Math.max(acc, microToNumber(d.supply), microToNumber(d.demand)), 0);
    return { rows: active, rStarTick: x.rStarTick, max: m };
  }, [depth]);

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 text-sm text-gray-600 py-12">
        <span className="w-1.5 h-1.5 rounded-full bg-cipher-500 animate-pulse-soft" />
        No bids yet this epoch — encrypted orders are streaming in…
      </div>
    );
  }

  const barPct = (v: bigint) => (max > 0 ? Math.max(3, (microToNumber(v) / max) * 100) : 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-gray-500">
            <th className="text-right font-medium py-1.5 pr-3">Supply · lend</th>
            <th className="text-center font-medium py-1.5 px-2">Rate</th>
            <th className="text-left font-medium py-1.5 pl-3">Demand · borrow</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const isRStar = d.tick === rStarTick;
            return (
              <tr
                key={d.tick}
                onClick={onPickRate ? () => onPickRate(d.tick) : undefined}
                className={clsx(
                  'border-t border-white/[0.03] transition-colors',
                  onPickRate && 'cursor-pointer hover:bg-white/[0.025]',
                  isRStar && 'bg-benchmark-500/[0.06]',
                )}
              >
                {/* supply (asks / lenders) — cyan, bar grows leftward */}
                <td className="py-1.5 pr-3">
                  <div className="flex items-center justify-end gap-2">
                    <span className={clsx('num text-xs', d.supply > 0n ? 'text-cipher-300' : 'text-gray-700')}>
                      {d.supply > 0n ? formatUsdcCompact(d.supply) : '·'}
                    </span>
                    <div className="w-16 sm:w-20 h-2 rounded-sm bg-white/[0.02] overflow-hidden flex justify-end">
                      {d.supply > 0n && <div className="h-full bg-cipher-500/50" style={{ width: `${barPct(d.supply)}%` }} />}
                    </div>
                  </div>
                </td>
                {/* rate tick — r* highlighted */}
                <td className="py-1.5 px-2 text-center whitespace-nowrap">
                  <span className={clsx('num', isRStar ? 'text-benchmark-300 font-semibold' : 'text-gray-400')}>
                    {bpsToPctLabel(tickToBps(d.tick))}
                  </span>
                  {isRStar && <span className="block text-[9px] uppercase tracking-wider text-benchmark-400/80 leading-none">r*</span>}
                </td>
                {/* demand (bids / borrowers) — gold, bar grows rightward */}
                <td className="py-1.5 pl-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 sm:w-20 h-2 rounded-sm bg-white/[0.02] overflow-hidden">
                      {d.demand > 0n && <div className="h-full bg-benchmark-500/50" style={{ width: `${barPct(d.demand)}%` }} />}
                    </div>
                    <span className={clsx('num text-xs', d.demand > 0n ? 'text-benchmark-300' : 'text-gray-700')}>
                      {d.demand > 0n ? formatUsdcCompact(d.demand) : '·'}
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
