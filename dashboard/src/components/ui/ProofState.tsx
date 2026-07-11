import { Loader2, Check, X, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import type { ProofProgress } from '../../lib/adapter/types';

// Honest proof-gen surface. Never hides latency — it's honesty, not shame.
export function ProofState({ progress, className }: { progress: ProofProgress | null; className?: string }) {
  if (!progress) return null;
  const done = progress.phase === 'done';
  const err = progress.phase === 'error';
  const verifying = progress.phase === 'verifying';
  const Icon = done ? Check : err ? X : verifying ? ShieldCheck : Loader2;

  return (
    <div
      className={clsx(
        'flex items-center gap-2 text-sm num',
        done ? 'text-signal-up' : err ? 'text-signal-down' : 'text-cipher-300',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Icon className={clsx('w-4 h-4', !done && !err && 'animate-spin')} />
      <span>
        {progress.label}
        {progress.ms ? <span className="text-gray-500 ml-1">({(progress.ms / 1000).toFixed(1)}s)</span> : null}
      </span>
    </div>
  );
}
