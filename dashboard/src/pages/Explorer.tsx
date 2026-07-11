import { Lock, ArrowRight, Radio } from 'lucide-react';
import { useMarketStore } from '../stores/useMarketStore';
import { useEventFeed } from '../hooks/useEventFeed';
import { MoniaTicker } from '../components/ui/MoniaTicker';
import { DepthChart } from '../components/ui/DepthChart';
import { shortAddr } from '../components/ui/AddressChip';
import { bpsToPctLabel, tickToBps } from '../lib/rates';
import { TAGLINE } from '../config';
import type { WindowEvent } from '../lib/adapter/types';

const trunc = (s: string) => (s.length > 12 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s);

function EventRow({ e }: { e: WindowEvent }) {
  switch (e.type) {
    case 'BidSubmitted':
      return (
        <div className="py-1.5 border-b border-white/[0.04] animate-fade-in-down">
          <div className="flex items-center gap-2 text-[11px]">
            <span className={e.side === 'ask' ? 'text-signal-up' : 'text-benchmark-400'}>
              {e.side === 'ask' ? 'ASK' : 'BID'}
            </span>
            <span className="text-gray-500">rate</span>
            <span className="text-white num">{bpsToPctLabel(tickToBps(e.tick))}</span>
            <span className="text-gray-600">·</span>
            <span className="num text-gray-500">{shortAddr(e.by)}</span>
            {!e.simulated && <span className="text-[9px] text-cipher-400">you</span>}
            <span className="ml-auto inline-flex items-center gap-1 text-cipher-400">
              <Lock className="w-3 h-3" /> amount encrypted
            </span>
          </div>
          <div className="num text-[10px] text-cipher-300/60 mt-0.5 truncate">
            c1=({trunc(e.cipher.c1[0])}, {trunc(e.cipher.c1[1])}) c2=({trunc(e.cipher.c2[0])}, {trunc(e.cipher.c2[1])})
          </div>
        </div>
      );
    case 'PrivateTransfer':
      return (
        <div className="py-1.5 border-b border-white/[0.04] animate-fade-in-down">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-cipher-300">TRANSFER</span>
            <span className="num text-gray-500">{shortAddr(e.from)}</span>
            <ArrowRight className="w-3 h-3 text-gray-600" />
            <span className="num text-gray-500">{shortAddr(e.to)}</span>
            <span className="ml-auto inline-flex items-center gap-1 text-cipher-400">
              <Lock className="w-3 h-3" /> amount encrypted
            </span>
          </div>
          <div className="num text-[10px] text-cipher-300/50 mt-0.5 truncate">auditorPCT=[{e.auditorPCT.slice(0, 3).map(trunc).join(', ')}…]</div>
        </div>
      );
    case 'RatePrinted':
      return (
        <div className="py-1.5 border-b border-white/[0.04]">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-benchmark-400">PRINT</span>
            <span className="text-gray-500">epoch {e.print.epoch}</span>
            <span className="rate-print text-xs">{e.print.rStarBps != null ? bpsToPctLabel(e.print.rStarBps) : 'no-trade'}</span>
            <span className="ml-auto text-signal-up text-[10px]">PoCD ✓ public</span>
          </div>
        </div>
      );
    case 'EpochClosed':
      return <div className="py-1 text-[11px] text-signal-stale">— epoch {e.epoch} closed —</div>;
    case 'LoanFunded':
      return <div className="py-1 text-[11px] text-gray-500">loan {e.loanId} funded · <span className="text-cipher-400">principal encrypted</span></div>;
    case 'LoanRepaid':
      return <div className="py-1 text-[11px] text-signal-up">loan {e.loanId} repaid · collateral released</div>;
    case 'LoanSeized':
      return <div className="py-1 text-[11px] text-signal-down">loan {e.loanId} defaulted · collateral seized</div>;
    default:
      return null;
  }
}

export default function Explorer() {
  const { latestMonia, history, depth } = useMarketStore();
  const feed = useEventFeed();
  const shown = [...feed].reverse().slice(0, 20);

  return (
    <div className="animate-fade-in">
      <div className="grid lg:grid-cols-2 gap-0 rounded-2xl overflow-hidden border border-white/[0.06]">
        {/* LEFT — ciphertext */}
        <div className="bg-surface-1/80 p-6 relative">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-cipher-300">
              <Lock className="w-4 h-4" /> What the chain stores
            </div>
            <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-cipher-400/70">
              <Radio className="w-3 h-3 animate-pulse-soft" /> ciphertext
            </span>
          </div>
          <div className="space-y-0 min-h-[380px] max-h-[440px] overflow-y-auto font-mono">
            {shown.length === 0 && <p className="text-xs text-gray-600">Waiting for encrypted orders…</p>}
            {shown.map((e, i) => (
              <EventRow key={`${i}-${e.type}`} e={e} />
            ))}
          </div>
        </div>

        {/* RIGHT — public rate */}
        <div className="bg-surface-2 p-6 relative border-t lg:border-t-0 lg:border-l border-benchmark-500/15">
          <div className="flex items-center gap-2 text-sm font-semibold text-benchmark-300 mb-4">
            What the public sees
          </div>
          <MoniaTicker latest={latestMonia} history={history} />
          <div className="mt-5">
            <DepthChart depth={depth.some((d) => d.supply > 0n || d.demand > 0n) ? depth : latestMonia?.depth ?? []} height={200} />
          </div>
        </div>
      </div>

      {/* Tagline seam */}
      <div className="text-center py-8">
        <div className="divider-glow max-w-md mx-auto mb-5" />
        <p className="text-xl sm:text-2xl font-semibold text-white">
          The rate is <span className="text-benchmark-400">public</span>. The borrowing <span className="text-cipher-300">never was</span>.
        </p>
        <p className="text-xs text-gray-600 mt-2 num">{TAGLINE}</p>
      </div>
    </div>
  );
}
