import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { useMarketStore } from '../stores/useMarketStore';
import { bpsToPctLabel } from '../lib/rates';

// Persistent live M-ONIA rate — always visible in the header, pulsing gold on a new print.
// The benchmark, ever-present, is the core "terminal" feel.
export default function HeaderTicker({ compact = false }: { compact?: boolean }) {
  const latest = useMarketStore((s) => s.latestMonia);
  const history = useMarketStore((s) => s.history);
  const rate = latest?.rStarBps ?? null;

  const [pulse, setPulse] = useState(false);
  const lastEpoch = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (latest && latest.epoch !== lastEpoch.current) {
      lastEpoch.current = latest.epoch;
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 1000);
      return () => clearTimeout(t);
    }
  }, [latest]);

  const printed = history.filter((p) => p.rStarBps != null);
  const prev = printed.length >= 2 ? printed[printed.length - 2].rStarBps : null;
  const delta = rate != null && prev != null ? rate - prev : 0;

  return (
    <Link
      to="/"
      className={clsx(
        'flex items-center gap-1.5 glass px-2.5 py-1.5 transition-shadow duration-500',
        pulse && 'shadow-glow',
      )}
      aria-live="polite"
      aria-label={`M-ONIA ${rate != null ? bpsToPctLabel(rate) : 'pending'}`}
      title="M-ONIA — live clearing rate"
    >
      {!compact && <span className="text-[10px] uppercase tracking-wider text-gray-500">M-ONIA</span>}
      {rate != null ? (
        <span className="rate-print text-sm num leading-none">{bpsToPctLabel(rate)}</span>
      ) : (
        <span className="num text-sm text-gray-600 leading-none">—</span>
      )}
      {delta !== 0 && (
        <span className={clsx('num text-[10px]', delta > 0 ? 'text-signal-down' : 'text-signal-up')}>
          {delta > 0 ? '▲' : '▼'}
          {Math.abs(delta)}
        </span>
      )}
    </Link>
  );
}
