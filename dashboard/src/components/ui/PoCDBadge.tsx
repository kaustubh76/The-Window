import { ShieldCheck } from 'lucide-react';
import type { PoCD } from '../../lib/adapter/types';
import { ADAPTER_MODE } from '../../config';

// "PoCD verified ✓" — the trust anchor. Every M-ONIA print must render this.
export function PoCDBadge({ pocd, compact }: { pocd: PoCD; compact?: boolean }) {
  // Honest per mode: the proof verifies on-chain only in live; in mock the ElGamal work is
  // real but the verification is part of the in-browser simulation.
  const tip =
    (ADAPTER_MODE === 'live'
      ? `Proof of correct decryption verified on-chain`
      : `Proof of correct decryption · verified in the in-browser simulation`) +
    (pocd.gasUsed ? ` · ${(pocd.gasUsed / 1000).toFixed(0)}k gas` : '') +
    (pocd.proveMs ? ` · proved in ${(pocd.proveMs / 1000).toFixed(1)}s` : '');
  return (
    <span className="pocd-badge num" title={tip}>
      <ShieldCheck className="w-3 h-3" />
      {compact ? 'PoCD ✓' : 'PoCD verified'}
    </span>
  );
}
