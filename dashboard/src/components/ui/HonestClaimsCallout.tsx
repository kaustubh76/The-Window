import { ShieldAlert } from 'lucide-react';
import { AUDITOR_DISCLOSURE } from '../../lib/honestClaims';

// The mandatory honest-claims framing. The auditor CAN decrypt individual amounts —
// we state this proudly (SOFR model), never hide it.
export function HonestClaimsCallout({ compact }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex items-start gap-2.5 text-xs text-gray-500 leading-relaxed">
        <ShieldAlert className="w-4 h-4 text-benchmark-500/70 flex-shrink-0 mt-0.5" />
        <p>{AUDITOR_DISCLOSURE}</p>
      </div>
    );
  }
  return (
    <div className="glass p-4 border-benchmark-500/15">
      <div className="flex items-center gap-2 text-sm font-semibold text-benchmark-300 mb-2">
        <ShieldAlert className="w-4 h-4" /> The honest leak budget
      </div>
      <p className="text-sm text-gray-400 leading-relaxed">{AUDITOR_DISCLOSURE}</p>
      <p className="text-xs text-gray-600 mt-2">
        Hidden: bid sizes, loan sizes, collateral, repayments, balances, borrowing history. Public: rate ticks,
        addresses, epoch timing, M-ONIA prints, aggregate depth, loan lifecycle events.
      </p>
    </div>
  );
}
