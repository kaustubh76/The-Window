import { Radio, FlaskConical } from 'lucide-react';
import { useEventFeed } from '../../hooks/useEventFeed';
import { TxLink } from './TxLink';
import { Card, CardHeader } from './Card';
import { shortAddr } from './AddressChip';
import { bpsToPctLabel, tickToBps } from '../../lib/rates';
import { ADAPTER_MODE } from '../../config';
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

// On-chain activity feed. On a LIVE deployment these are the real Fuji txs the autonomous
// stack fires, each linking out to Snowtrace. In the default MOCK deployment there is no
// chain, so the header must say so honestly (no "Real Fuji" / pulsing "live" claim) — the
// mode gate below keeps this feed truthful in both builds. Reuses the Explorer firehose.
const IS_LIVE = ADAPTER_MODE === 'live';
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
        title={IS_LIVE ? 'Live on-chain activity' : 'Simulated market activity'}
        subtitle={
          IS_LIVE
            ? 'Real Fuji transactions — click to verify on Snowtrace'
            : 'Demo engine — connect a live deployment to see real Snowtrace links'
        }
        right={
          IS_LIVE ? (
            <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-benchmark-400/80">
              <Radio className="w-3 h-3 animate-pulse-soft" /> live
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-gray-500">
              <FlaskConical className="w-3 h-3" /> demo
            </span>
          )
        }
      />
      <div className="space-y-0 max-h-[280px] overflow-y-auto">
        {rows.length === 0 && (
          <p className="text-sm text-gray-600 py-2">{IS_LIVE ? 'Waiting for on-chain transactions…' : 'Simulating market activity…'}</p>
        )}
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
