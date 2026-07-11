import clsx from 'clsx';
import { useClock } from '../../hooks/useClock';

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// Countdown to a virtual-clock target. Reads clock.now (never Date.now) so it works
// under DEMO scrubbing and PROD block-time alike.
export function Countdown({
  targetMs,
  label,
  className,
  urgentUnderMs = 5000,
}: {
  targetMs: number;
  label?: string;
  className?: string;
  urgentUnderMs?: number;
}) {
  const clock = useClock();
  const now = clock?.now ?? 0;
  const remaining = targetMs - now;
  const urgent = remaining > 0 && remaining < urgentUnderMs;
  const done = remaining <= 0;

  return (
    <span className={clsx('inline-flex items-center gap-1.5 num tabular-nums', className)}>
      {label && <span className="text-gray-500 text-xs">{label}</span>}
      <span className={clsx('font-semibold', done ? 'text-gray-500' : urgent ? 'text-signal-down animate-pulse-soft' : 'text-white')}>
        {done ? '—' : fmt(remaining)}
      </span>
    </span>
  );
}
