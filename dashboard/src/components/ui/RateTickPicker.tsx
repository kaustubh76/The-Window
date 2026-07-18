import { useRef } from 'react';
import clsx from 'clsx';
import { allTicks, tickToBps } from '../../lib/rates';
import { TICK_COUNT } from '../../config';
import type { TickIndex } from '../../lib/adapter/types';

// 37-tick rate ladder (1.00%–10.00% @ 25bps). Keyboard-navigable radiogroup.
export function RateTickPicker({
  value,
  onChange,
  rStarTick,
  side,
  taken,
}: {
  value: TickIndex | null;
  onChange: (t: TickIndex) => void;
  rStarTick?: TickIndex | null;
  side: 'ask' | 'bid';
  taken?: Set<number>; // ticks this member already bid this epoch (re-bidding reverts AlreadyBidHere)
}) {
  const ref = useRef<HTMLDivElement>(null);
  const ticks = allTicks();

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(Math.min(TICK_COUNT - 1, (value ?? 0) + 1));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(Math.max(0, (value ?? 0) - 1));
    }
  };

  return (
    <div>
      <div
        ref={ref}
        role="radiogroup"
        aria-label={side === 'ask' ? 'Minimum acceptable rate' : 'Maximum acceptable rate'}
        onKeyDown={onKey}
        tabIndex={0}
        className="flex items-end gap-0.5 overflow-x-auto pb-2 focus:outline-none"
      >
        {ticks.map(({ tick, bps, label }) => {
          const whole = bps % 100 === 0;
          const selected = value === tick;
          const isStar = rStarTick === tick;
          const isTaken = taken?.has(tick) ?? false;
          return (
            <button
              key={tick}
              role="radio"
              aria-checked={selected}
              aria-label={isTaken ? `${label} — already bid` : label}
              onClick={() => onChange(tick)}
              className={clsx(
                'relative flex-shrink-0 w-3 rounded-sm transition-all duration-150',
                selected ? 'bg-benchmark-500' : isTaken ? 'bg-white/[0.05] opacity-40' : isStar ? 'bg-cipher-500/50' : 'bg-white/[0.08] hover:bg-white/[0.16]',
              )}
              style={{ height: whole ? 28 : 18 }}
              title={isTaken ? `${label} — you already bid here this epoch` : label}
            >
              {isStar && !selected && <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-cipher-400" />}
              {isTaken && !selected && <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-px bg-gray-500" />}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] num text-gray-600 mt-1">
        <span>1%</span>
        <span>5%</span>
        <span>10%</span>
      </div>
      <div className="mt-2 text-sm num">
        {value !== null ? (
          <span className="text-benchmark-300">
            {side === 'ask' ? 'min' : 'max'} rate {(tickToBps(value) / 100).toFixed(2)}%
          </span>
        ) : (
          <span className="text-gray-600">Pick a rate tick</span>
        )}
      </div>
    </div>
  );
}
