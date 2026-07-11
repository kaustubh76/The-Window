import clsx from 'clsx';
import type { EpochStatus, LoanStatus, Side } from '../../lib/adapter/types';

const styles: Record<string, string> = {
  // epoch
  Open: 'bg-cipher-500/12 text-cipher-300 border border-cipher-500/25',
  Closed: 'bg-signal-stale/12 text-signal-stale border border-signal-stale/25',
  Printed: 'bg-benchmark-500/15 text-benchmark-300 border border-benchmark-500/30',
  // loan
  Pending: 'bg-white/[0.05] text-gray-400 border border-white/[0.08]',
  Active: 'bg-cipher-500/12 text-cipher-300 border border-cipher-500/25',
  Repaid: 'bg-signal-up/12 text-signal-up border border-signal-up/25',
  Defaulted: 'bg-signal-down/12 text-signal-down border border-signal-down/25',
};

export function StatusPill({ status }: { status: EpochStatus | LoanStatus }) {
  return <span className={clsx('pill num', styles[status] ?? styles.Pending)}>{status}</span>;
}

export function SideBadge({ side }: { side: Side }) {
  const isAsk = side === 'ask';
  return (
    <span
      className={clsx(
        'pill num',
        isAsk ? 'bg-signal-up/10 text-signal-up border border-signal-up/20' : 'bg-benchmark-500/10 text-benchmark-300 border border-benchmark-500/20',
      )}
    >
      {isAsk ? 'ASK · lend' : 'BID · borrow'}
    </span>
  );
}
