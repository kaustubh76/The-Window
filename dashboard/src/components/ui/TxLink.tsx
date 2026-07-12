import { ExternalLink } from 'lucide-react';
import { SNOWTRACE_URL } from '../../config';
import { EXPLORER_TX } from '../../constants/ui';
import type { Hex } from '../../lib/adapter/types';

// A compact "↗ tx" link to the on-chain transaction on Snowtrace (Fuji).
// Renders nothing when there's no hash (e.g. mock events without a real tx).
export function TxLink({ hash, className = '' }: { hash?: Hex | string | null; className?: string }) {
  if (!hash) return null;
  const short = `${hash.slice(0, 6)}…${hash.slice(-4)}`;
  return (
    <a
      href={EXPLORER_TX(hash, SNOWTRACE_URL)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`View on Snowtrace: ${hash}`}
      className={`inline-flex items-center gap-1 text-[10px] num text-benchmark-400/80 hover:text-benchmark-300 transition-colors ${className}`}
    >
      <ExternalLink className="w-3 h-3" />
      <span className="hidden sm:inline">{short}</span>
      <span className="sm:hidden">tx</span>
    </a>
  );
}
