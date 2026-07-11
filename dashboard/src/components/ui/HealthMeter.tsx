import clsx from 'clsx';
import { Lock } from 'lucide-react';
import { HAIRCUT_PCT } from '../../config';

// Collateral health vs the fixed 120% haircut. Only shown to entitled viewers (owner);
// otherwise a locked chip.
export function HealthMeter({ healthPct }: { healthPct?: number }) {
  if (healthPct === undefined) {
    return (
      <span className="chip-encrypted text-xs" title="Collateral is encrypted; health visible only to the owner.">
        <Lock className="w-3 h-3" /> health encrypted
      </span>
    );
  }
  const healthy = healthPct >= HAIRCUT_PCT;
  const max = 180;
  const fill = Math.min(100, (healthPct / max) * 100);
  const haircutMark = (HAIRCUT_PCT / max) * 100;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-gray-500">collateral health</span>
        <span className={clsx('num font-semibold', healthy ? 'text-signal-up' : 'text-signal-down')}>
          {healthPct}% · {healthy ? 'healthy' : 'at risk'}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className={clsx('absolute inset-y-0 left-0 rounded-full transition-all duration-500', healthy ? 'bg-signal-up' : 'bg-signal-down')}
          style={{ width: `${fill}%` }}
        />
        <div className="absolute inset-y-0 w-0.5 bg-benchmark-400/80" style={{ left: `${haircutMark}%` }} title={`${HAIRCUT_PCT}% haircut`} />
      </div>
    </div>
  );
}
