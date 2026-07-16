import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Lock, ArrowRight, Radio, Eye, Pause, Play, KeyRound, Highlighter } from 'lucide-react';
import { useMarketStore } from '../stores/useMarketStore';
import { useSessionStore } from '../stores/useSessionStore';
import { useEventFeed } from '../hooks/useEventFeed';
import { MoniaTicker } from '../components/ui/MoniaTicker';
import { DepthChart } from '../components/ui/DepthChart';
import { shortAddr } from '../components/ui/AddressChip';
import { TxLink } from '../components/ui/TxLink';
import { bpsToPctLabel, tickToBps } from '../lib/rates';
import { formatUsdc } from '../lib/usdc';
import { TAGLINE } from '../config';
import type { WindowEvent } from '../lib/adapter/types';

const trunc = (s: string) => (s.length > 12 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s);

// Filter categories — group the raw event stream into things a reader actually thinks in.
type Category = 'all' | 'bids' | 'prints' | 'loans' | 'transfers';
const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'bids', label: 'Bids' },
  { key: 'prints', label: 'Prints' },
  { key: 'loans', label: 'Loans' },
  { key: 'transfers', label: 'Transfers' },
];
function categoryOf(e: WindowEvent): Category {
  switch (e.type) {
    case 'BidSubmitted': return 'bids';
    case 'PrivateTransfer': return 'transfers';
    case 'RatePrinted': case 'EpochOpened': case 'EpochClosed': return 'prints';
    default: return 'loans'; // Matches/LoanFunded/LoanRepaid/LoanSeized
  }
}
const isCipher = (e: WindowEvent) => e.type === 'BidSubmitted' || e.type === 'PrivateTransfer';

function EventRow({
  e,
  myAddress,
  highlightMine,
  expanded,
  onToggle,
}: {
  e: WindowEvent;
  myAddress?: string | null;
  highlightMine: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  switch (e.type) {
    case 'BidSubmitted': {
      const mine = !!myAddress && e.by?.toLowerCase() === myAddress.toLowerCase();
      const ring = mine && highlightMine;
      const clear = e.cipher.clear; // populated only for the entitled owner
      return (
        <div className={clsx('py-1.5 border-b border-white/[0.04] animate-fade-in-down', ring && '-mx-2 px-2 rounded-lg bg-benchmark-500/[0.06] border-benchmark-500/25')}>
          <button onClick={onToggle} className="w-full text-left" aria-expanded={expanded}>
            <div className="flex items-center gap-2 text-[11px]">
              <span className={e.side === 'ask' ? 'text-signal-up' : 'text-benchmark-400'}>
                {e.side === 'ask' ? 'ASK' : 'BID'}
              </span>
              <span className="text-gray-500">rate</span>
              <span className="text-white num">{bpsToPctLabel(tickToBps(e.tick))}</span>
              <span className="text-gray-600">·</span>
              <span className="num text-gray-500">{shortAddr(e.by)}</span>
              {ring && (
                <span className="relative inline-flex items-center">
                  <span className="text-[9px] uppercase tracking-wider text-benchmark-400 font-semibold">you</span>
                  <span className="absolute -right-1.5 top-0 w-1.5 h-1.5 rounded-full bg-benchmark-400 animate-ping-slow" />
                </span>
              )}
              <span className="ml-auto inline-flex items-center gap-2">
                {mine && clear != null ? (
                  <span className="inline-flex items-center gap-1 text-benchmark-300 num" title="Only you can decrypt your own size">
                    <Eye className="w-3 h-3" /> {formatUsdc(clear)} USDC
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-cipher-400">
                    <Lock className="w-3 h-3" /> amount encrypted
                  </span>
                )}
                <TxLink hash={e.txHash} />
              </span>
            </div>
            <div className="num text-[10px] text-cipher-300/60 mt-0.5 truncate">
              c1=({trunc(e.cipher.c1[0])}, {trunc(e.cipher.c1[1])}) c2=({trunc(e.cipher.c2[0])}, {trunc(e.cipher.c2[1])})
            </div>
          </button>
          {expanded && (
            <div className="mt-2 mb-1 rounded-lg bg-surface-0/60 border border-white/[0.06] p-2.5 animate-fade-in">
              <div className="num text-[10px] text-cipher-300/70 space-y-0.5 break-all">
                <div>c1 = ({e.cipher.c1[0]}, {e.cipher.c1[1]})</div>
                <div>c2 = ({e.cipher.c2[0]}, {e.cipher.c2[1]})</div>
              </div>
              <div className="mt-2 pt-2 border-t border-white/[0.06] text-[11px]">
                {mine && clear != null ? (
                  <span className="inline-flex items-center gap-1.5 text-benchmark-300">
                    <KeyRound className="w-3.5 h-3.5" /> Your key opens this: <span className="num font-semibold">{formatUsdc(clear)} USDC</span>
                  </span>
                ) : (
                  <span className="inline-flex items-start gap-1.5 text-gray-400">
                    <Lock className="w-3.5 h-3.5 mt-0.5 text-cipher-400 flex-shrink-0" />
                    <span>
                      Encrypted to <span className="num text-gray-300">{shortAddr(e.by)}</span>’s key. Only they — and the
                      accountable Benchmark Administrator — hold a key to open it. <span className="text-gray-500">You can’t. That’s the point.</span>
                    </span>
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      );
    }
    case 'PrivateTransfer':
      return (
        <div className="py-1.5 border-b border-white/[0.04] animate-fade-in-down">
          <button onClick={onToggle} className="w-full text-left" aria-expanded={expanded}>
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
          </button>
          {expanded && (
            <div className="mt-2 mb-1 rounded-lg bg-surface-0/60 border border-white/[0.06] p-2.5 animate-fade-in text-[11px] text-gray-400">
              <span className="inline-flex items-start gap-1.5">
                <Lock className="w-3.5 h-3.5 mt-0.5 text-cipher-400 flex-shrink-0" />
                <span>
                  A private eERC transfer. The amount is encrypted end-to-end; the <span className="text-cipher-300">auditorPCT</span> lets
                  the accountable Benchmark Administrator — and no passer-by — verify it. The chain stores only ciphertext.
                </span>
              </span>
            </div>
          )}
        </div>
      );
    case 'RatePrinted':
      return (
        <div className="py-1.5 border-b border-white/[0.04]">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-benchmark-400">PRINT</span>
            <span className="text-gray-500">epoch {e.print.epoch}</span>
            <span className="rate-print text-xs">{e.print.rStarBps != null ? bpsToPctLabel(e.print.rStarBps) : 'no-trade'}</span>
            <span className="ml-auto inline-flex items-center gap-2">
              <span className="text-signal-up text-[10px]">PoCD ✓ public</span>
              <TxLink hash={e.txHash} />
            </span>
          </div>
        </div>
      );
    case 'EpochOpened':
      return (
        <div className="py-1 text-[11px] text-benchmark-400/70 flex items-center gap-2">
          <span>— epoch {e.epoch} opened —</span>
          <TxLink hash={e.txHash} className="ml-auto" />
        </div>
      );
    case 'EpochClosed':
      return (
        <div className="py-1 text-[11px] text-signal-stale flex items-center gap-2">
          <span>— epoch {e.epoch} closed —</span>
          <TxLink hash={e.txHash} className="ml-auto" />
        </div>
      );
    case 'MatchesPosted':
      return (
        <div className="py-1 text-[11px] text-benchmark-300 flex items-center gap-2">
          <span>loan matched · pair created on-chain</span>
          <TxLink hash={e.txHash} className="ml-auto" />
        </div>
      );
    case 'LoanFunded':
      return (
        <div className="py-1 text-[11px] text-gray-500 flex items-center gap-2">
          <span>loan {e.loanId} funded · <span className="text-cipher-400">principal encrypted</span></span>
          <TxLink hash={e.txHash} className="ml-auto" />
        </div>
      );
    case 'LoanRepaid':
      return (
        <div className="py-1 text-[11px] text-signal-up flex items-center gap-2">
          <span>loan {e.loanId} repaid · collateral released</span>
          <TxLink hash={e.txHash} className="ml-auto" />
        </div>
      );
    case 'LoanSeized':
      return (
        <div className="py-1 text-[11px] text-signal-down flex items-center gap-2">
          <span>loan {e.loanId} defaulted · collateral seized</span>
          <TxLink hash={e.txHash} className="ml-auto" />
        </div>
      );
    default:
      return null;
  }
}

export default function Explorer() {
  const { latestMonia, history, depth } = useMarketStore();
  const myAddress = useSessionStore((s) => s.address);
  const feed = useEventFeed();

  const [category, setCategory] = useState<Category>('all');
  const [highlightMine, setHighlightMine] = useState(true);
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState<WindowEvent[] | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const togglePause = () => {
    setPaused((p) => {
      const next = !p;
      setFrozen(next ? [...feed] : null); // snapshot on pause so a row can actually be read
      return next;
    });
  };

  // Source: the live feed, or the frozen snapshot while paused. Filter + newest-first.
  const source = paused && frozen ? frozen : feed;
  const shown = useMemo(() => {
    const rev = [...source].reverse();
    const filtered = category === 'all' ? rev : rev.filter((e) => categoryOf(e) === category);
    return filtered.slice(0, 24);
  }, [source, category]);

  const mineCount = myAddress ? feed.filter((e) => e.type === 'BidSubmitted' && e.by?.toLowerCase() === myAddress.toLowerCase()).length : 0;

  return (
    <div className="animate-fade-in">
      {/* Control row — the firehose becomes something you steer */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex items-center gap-1 bg-white/[0.03] rounded-xl p-1 border border-white/[0.04]">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                category === c.key ? 'bg-benchmark-500/15 text-benchmark-300' : 'text-gray-500 hover:text-gray-300',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        {myAddress && (
          <button
            onClick={() => setHighlightMine((h) => !h)}
            className={clsx(
              'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors',
              highlightMine ? 'bg-benchmark-500/10 text-benchmark-300 border-benchmark-500/20' : 'text-gray-500 border-white/[0.06] hover:text-gray-300',
            )}
            title="Ring your own orders in the stream"
          >
            <Highlighter className="w-3.5 h-3.5" /> Highlight mine{mineCount > 0 ? ` (${mineCount})` : ''}
          </button>
        )}
        <button
          onClick={togglePause}
          className={clsx(
            'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ml-auto',
            paused ? 'bg-signal-stale/10 text-signal-stale border-signal-stale/25' : 'text-gray-400 border-white/[0.06] hover:text-white',
          )}
          title={paused ? 'Resume the live stream' : 'Freeze the stream so you can read a row'}
        >
          {paused ? <><Play className="w-3.5 h-3.5" /> Paused</> : <><Pause className="w-3.5 h-3.5" /> Pause</>}
        </button>
      </div>

      <div className="grid lg:grid-cols-2 gap-0 rounded-2xl overflow-hidden border border-white/[0.06]">
        {/* LEFT — ciphertext */}
        <div className="bg-surface-1/80 p-6 relative">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-cipher-300">
              <Lock className="w-4 h-4" /> What the chain stores
            </div>
            <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-cipher-400/70">
              <Radio className={clsx('w-3 h-3', !paused && 'animate-pulse-soft')} /> {paused ? 'frozen' : 'ciphertext'}
            </span>
          </div>
          <p className="text-[11px] text-gray-600 mb-2">Tap an encrypted row to inspect its ciphertext — and see who can (and can’t) open it.</p>
          <div className="space-y-0 min-h-[380px] max-h-[460px] overflow-y-auto font-mono">
            {shown.length === 0 && <p className="text-xs text-gray-600">{category === 'all' ? 'Waiting for encrypted orders…' : `No ${category} in the stream yet…`}</p>}
            {shown.map((e, i) => {
              const key = `${i}-${e.type}`;
              return (
                <EventRow
                  key={key}
                  e={e}
                  myAddress={myAddress}
                  highlightMine={highlightMine}
                  expanded={expandedKey === key}
                  onToggle={() => isCipher(e) && setExpandedKey((k) => (k === key ? null : key))}
                />
              );
            })}
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
