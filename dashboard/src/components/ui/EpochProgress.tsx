import clsx from 'clsx';
import { useClock } from '../../hooks/useClock';

// A thin bar under the header that fills with the current epoch's elapsed time — the
// visible heartbeat of the hourly auction rhythm. Resets each epoch.
export function EpochProgress() {
  const clock = useClock();
  const full = clock?.epochLenMs ?? 0;
  const elapsed = clock ? Math.max(0, Math.min(full, clock.now - clock.openedAt)) : 0;
  const pct = full > 0 ? (elapsed / full) * 100 : 0;

  const color =
    clock?.status === 'Printed'
      ? 'bg-benchmark-500'
      : clock?.status === 'Closed'
        ? 'bg-signal-stale'
        : 'bg-cipher-500/70';

  return (
    <div className="relative h-[3px] bg-white/[0.03] overflow-hidden" aria-hidden="true">
      <div
        className={clsx('absolute inset-y-0 left-0 transition-[width] duration-300 ease-linear', color)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
