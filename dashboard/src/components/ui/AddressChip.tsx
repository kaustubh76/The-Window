import clsx from 'clsx';
import { Copy, Check } from 'lucide-react';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import type { Address } from '../../lib/adapter/types';

export function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function AddressChip({
  address,
  label,
  simulated,
  className,
}: {
  address: Address;
  label?: string;
  simulated?: boolean;
  className?: string;
}) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <span className={clsx('inline-flex items-center gap-1.5', className)}>
      {label && <span className="text-sm text-gray-300">{label}</span>}
      <span className="inline-flex items-center gap-1 glass px-2 py-0.5">
        <span className="num text-xs text-gray-400">{shortAddr(address)}</span>
        <button
          onClick={() => copy(address)}
          className="text-gray-600 hover:text-white transition-colors"
          aria-label={copied ? 'Copied' : 'Copy address'}
        >
          {copied ? <Check className="w-3 h-3 text-signal-up" /> : <Copy className="w-3 h-3" />}
        </button>
      </span>
      {simulated && (
        <span className="text-[9px] uppercase tracking-wider text-benchmark-400/80 border border-benchmark-500/20 rounded px-1 py-0.5">
          sim
        </span>
      )}
    </span>
  );
}
