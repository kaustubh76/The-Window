import { ShieldCheck } from 'lucide-react';
import type { PoCD } from '../../lib/adapter/types';

// "PoCD verified ✓" — the trust anchor. Every M-ONIA print must render this.
export function PoCDBadge({ pocd, compact }: { pocd: PoCD; compact?: boolean }) {
  const tip =
    `Proof of correct decryption verified on-chain` +
    (pocd.gasUsed ? ` · ${(pocd.gasUsed / 1000).toFixed(0)}k gas` : '') +
    (pocd.proveMs ? ` · proved in ${(pocd.proveMs / 1000).toFixed(1)}s` : '');
  return (
    <span className="pocd-badge num" title={tip}>
      <ShieldCheck className="w-3 h-3" />
      {compact ? 'PoCD ✓' : 'PoCD verified'}
    </span>
  );
}
