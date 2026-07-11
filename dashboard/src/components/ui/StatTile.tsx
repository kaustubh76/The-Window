import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

export function StatTile({
  label,
  value,
  icon: Icon,
  accent = 'default',
  sub,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  accent?: 'default' | 'gold' | 'cipher' | 'up' | 'down';
  sub?: React.ReactNode;
}) {
  const accentText = {
    default: 'text-white',
    gold: 'text-benchmark-400',
    cipher: 'text-cipher-300',
    up: 'text-signal-up',
    down: 'text-signal-down',
  }[accent];

  return (
    <div className="glass px-4 py-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {label}
      </div>
      <div className={clsx('text-xl font-bold num tabular-nums', accentText)}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5 num">{sub}</div>}
    </div>
  );
}
