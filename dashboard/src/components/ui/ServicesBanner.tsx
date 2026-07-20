import { AlertTriangle, Loader2 } from 'lucide-react';
import { CONFIG_WARNINGS } from '../../config';
import { useMarketStore } from '../../stores/useMarketStore';

// Makes "backend not up yet" read as such instead of a silent epoch-#0 dashboard.
// Reads the SHARED market-store clock (not an independent useClock subscription,
// which can race to a transient fallback) so it never false-alarms while real data is live.
export function ServicesBanner() {
  const clock = useMarketStore((s) => s.clock);
  const history = useMarketStore((s) => s.history);
  const loanBook = useMarketStore((s) => s.loanBook);

  // Build-time misconfiguration (e.g. a hosted build with no VITE_CONTROL_URL) — surface it
  // unconditionally, before any clock/data gating, so a broken hosted deploy isn't silent.
  if (CONFIG_WARNINGS.length) {
    return (
      <div className="bg-signal-down/10 border-b border-signal-down/25 text-signal-down">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-1.5 flex items-center gap-2 text-xs">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{CONFIG_WARNINGS.join(' ')}</span>
        </div>
      </div>
    );
  }

  if (!clock) return null;

  // A reachable indexer always returns a real block timestamp (now > 0).
  const unreachable = clock.now === 0;
  // Genuinely nothing on-chain yet (no epoch length, no prints, no loans) — genesis only.
  const empty = !unreachable && clock.epochLenMs === 0 && history.length === 0 && loanBook.length === 0;
  if (!unreachable && !empty) return null;

  return (
    <div className="bg-signal-stale/10 border-b border-signal-stale/20 text-signal-stale">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-1.5 flex items-center gap-2 text-xs">
        {unreachable ? <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
        {unreachable ? (
          <span>Connecting to services — start the indexer (:8787) and Control API (:8899). Live data appears automatically.</span>
        ) : (
          <span>No auction epoch open yet — waiting for the keeper to open the first epoch.</span>
        )}
      </div>
    </div>
  );
}
