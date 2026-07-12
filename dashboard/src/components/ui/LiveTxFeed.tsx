import { Radio } from 'lucide-react';
import { useEventFeed } from '../../hooks/useEventFeed';
import { TxLink } from './TxLink';
import { Card, CardHeader } from './Card';
import { shortAddr } from './AddressChip';
import { bpsToPctLabel, tickToBps } from '../../lib/rates';
import type { WindowEvent } from '../../lib/adapter/types';

// One-line human label + accent color for an on-chain event in the live tx feed.
function describe(e: WindowEvent): { label: string; cls: string } | null {
  switch (e.type) {
    case 'BidSubmitted':
      return { label: `${e.side === 'ask' ? 'ASK' : 'BID'} @ ${bpsToPctLabel(tickToBps(e.tick))} · ${shortAddr(e.by)} · amount encrypted`, cls: e.side === 'ask' ? 'text-signal-up' : 'text-benchmark-400' };
    case 'EpochOpened': return { label: `epoch ${e.epoch} opened`, cls: 'text-benchmark-400/80' };
    case 'EpochClosed': return { label: `epoch ${e.epoch} closed`, cls: 'text-signal-stale' };
    case 'RatePrinted': return { label: `M-ONIA printed · epoch ${e.print.epoch} · ${e.print.rStarBps != null ? bpsToPctLabel(e.print.rStarBps) : 'no-trade'} · PoCD ✓`, cls: 'text-benchmark-300 font-semibold' };
    case 'MatchesPosted': return { label: 'loan matched · pair created', cls: 'text-benchmark-300' };
    case 'LoanFunded': return { label: `loan ${e.loanId} funded · principal encrypted`, cls: 'text-gray-400' };
    case 'LoanRepaid': return { label: `loan ${e.loanId} repaid · collateral released`, cls: 'text-signal-up' };
    case 'LoanSeized': return { label: `loan ${e.loanId} defaulted · collateral seized`, cls: 'text-signal-down' };
    default: return null;
  }
}

// Prominent "live on-chain activity" feed — the real Fuji txs the autonomous stack fires,
// each linking out to Snowtrace. Reuses the same firehose as the Explorer.
export function LiveTxFeed({ limit = 8 }: { limit?: number }) {
  const feed = useEventFeed();
  const rows = [...feed]
    .reverse()
    .map((e, i) => ({ e, i, d: describe(e) }))
    .filter((r) => r.d && (r.e as { txHash?: string }).txHash)
    .slice(0, limit);

  return (
    <Card>
      <CardHeader
        title="Live on-chain activity"
        subtitle="Real Fuji transactions — click to verify on Snowtrace"
        right={
          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-benchmark-400/80">
            <Radio className="w-3 h-3 animate-pulse-soft" /> live
          </span>
        }
      />
      <div className="space-y-0 max-h-[280px] overflow-y-auto">
        {rows.length === 0 && <p className="text-sm text-gray-600 py-2">Waiting for on-chain transactions…</p>}
        {rows.map(({ e, i, d }) => (
          <div key={`${i}-${e.type}`} className="flex items-center gap-2 py-1.5 border-b border-white/[0.04] last:border-0 text-[11px] animate-fade-in-down">
            <span className={`truncate ${d!.cls}`}>{d!.label}</span>
            <TxLink hash={(e as { txHash?: `0x${string}` }).txHash} className="ml-auto shrink-0" />
          </div>
        ))}
      </div>
    </Card>
  );
}
