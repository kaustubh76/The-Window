import { useState, useEffect } from 'react';
import { Lock, Send } from 'lucide-react';
import clsx from 'clsx';
import { Card, CardHeader } from '../components/ui/Card';
import { RateTickPicker } from '../components/ui/RateTickPicker';
import { DepthChart } from '../components/ui/DepthChart';
import { Countdown } from '../components/ui/Countdown';
import { StatusPill } from '../components/ui/StatusPill';
import { ProofState } from '../components/ui/ProofState';
import { EncryptedValue } from '../components/ui/EncryptedValue';
import { useMarketStore } from '../stores/useMarketStore';
import { usePositionsStore } from '../stores/usePositionsStore';
import { useClock } from '../hooks/useClock';
import { useSessionStore } from '../stores/useSessionStore';
import { useAdapterStore } from '../stores/useAdapterStore';
import { useTx } from '../hooks/useTx';
import { useToast } from '../contexts/ToastContext';
import { parseUsdc, belowMinBid, formatUsdc, microToNumber } from '../lib/usdc';
import { bpsToPctLabel, bpsToTick, tickToBps } from '../lib/rates';
import { PROFILE, minBidMicro } from '../config';
import type { Address, Side, TickIndex } from '../lib/adapter/types';

export default function AuctionPage() {
  const address = useSessionStore((s) => s.address) as Address;
  const persona = useSessionStore((s) => s.persona);
  const registered = useSessionStore((s) => s.registered);
  const clock = useClock();
  const { depth, latestMonia } = useMarketStore();
  const { myBids, balances, revealed } = usePositionsStore();
  const adapter = useAdapterStore((s) => s.adapter);
  const { run, progress, running } = useTx();
  const toast = useToast();

  const defaultSide: Side = persona.includes('lender') && !persona.includes('borrower') ? 'ask' : 'bid';
  const [side, setSide] = useState<Side>(defaultSide);
  const [tick, setTick] = useState<TickIndex | null>(null);
  const [size, setSize] = useState('');
  const [pulse, setPulse] = useState(false);
  useEffect(() => setSide(defaultSide), [defaultSide]);

  const rStarTick = latestMonia?.rStarBps != null ? bpsToTick(latestMonia.rStarBps) : null;
  const shownDepth = depth.some((d) => d.supply > 0n || d.demand > 0n) ? depth : latestMonia?.depth ?? [];

  // Safe parse for the live chart overlay (never throws while typing).
  const parsedSize = (() => {
    try {
      return size ? parseUsdc(size) : 0n;
    } catch {
      return 0n;
    }
  })();
  // Slider ceiling: your spendable encrypted balance, else a demo cap.
  const maxMicro = revealed ?? balances?.eercClear ?? 10_000_000000n;
  const maxUsdc = Math.max(1, Math.round(microToNumber(maxMicro)));
  const minUsdc = Math.max(1, Math.round(microToNumber(minBidMicro(PROFILE))));
  // Where a bid at the selected tick would clear relative to the last r*.
  const clears =
    tick == null || rStarTick == null
      ? null
      : side === 'ask'
        ? tick <= rStarTick // lender accepts r* if their min ≤ r*
        : tick >= rStarTick; // borrower accepts r* if their max ≥ r*

  const submit = async () => {
    if (!adapter || tick === null) return;
    if (!registered) return toast.error('Register your encryption key first (Wallet)');
    let micro: bigint;
    try {
      micro = parseUsdc(size);
    } catch {
      return toast.error('Invalid size');
    }
    if (belowMinBid(micro, PROFILE)) return toast.error(`Below minimum bid (${PROFILE === 'DEMO' ? '1' : '10'} USDC)`);
    const res = await run((onP) => (side === 'ask' ? adapter.submitAsk(address, tick, micro, onP) : adapter.submitBid(address, tick, micro, onP)));
    if (res.ok) {
      toast.success(`Encrypted ${side === 'ask' ? 'ask' : 'bid'} submitted at ${bpsToPctLabel(tickToBps(tick))}`, res.txHash, {
        label: 'See it in Explorer →',
        to: '/explorer',
      });
      setSize('');
      setPulse(true);
      setTimeout(() => setPulse(false), 1100);
    } else toast.error(res.error ?? 'Submit failed');
  };

  return (
    <div className="grid lg:grid-cols-[1fr_1.1fr] gap-6 animate-fade-in">
      {/* order ticket */}
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Auction</h1>
          <p className="text-gray-400 text-sm mt-1">Rate is public. Size is encrypted before it ever touches the chain.</p>
        </div>

        <Card className={clsx('transition-shadow duration-500', pulse && 'shadow-glow')}>
          <div className="flex items-center gap-1 bg-white/[0.03] rounded-lg p-1 mb-5">
            {(['bid', 'ask'] as Side[]).map((s) => (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={clsx(
                  'flex-1 py-2 rounded-md text-sm font-semibold transition-colors',
                  side === s
                    ? s === 'ask'
                      ? 'bg-signal-up/15 text-signal-up'
                      : 'bg-benchmark-500/15 text-benchmark-300'
                    : 'text-gray-500 hover:text-gray-300',
                )}
              >
                {s === 'ask' ? 'Lend (ask)' : 'Borrow (bid)'}
              </button>
            ))}
          </div>

          <div className="mb-5">
            <div className="text-xs text-gray-500 mb-2">{side === 'ask' ? 'Minimum acceptable rate' : 'Maximum acceptable rate'} · public</div>
            <RateTickPicker value={tick} onChange={setTick} rStarTick={rStarTick} side={side} />
          </div>

          <div className="mb-4">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
              <span>Size · encrypted</span>
              <span className="inline-flex items-center gap-1 text-cipher-400">
                <Lock className="w-3 h-3" /> hidden on-chain
              </span>
            </div>
            <input className="input num" placeholder={`Size in USDC (min ${PROFILE === 'DEMO' ? '1' : '10'})`} value={size} onChange={(e) => setSize(e.target.value)} inputMode="decimal" />
            <input
              type="range"
              min={minUsdc}
              max={maxUsdc}
              step={1}
              value={Math.min(maxUsdc, Math.max(0, Number(size) || 0))}
              onChange={(e) => setSize(e.target.value)}
              className="w-full mt-2.5 accent-benchmark-500 cursor-pointer"
              aria-label="Bid size"
            />
            <div className="flex items-center justify-between text-[11px] mt-1.5 num">
              <span className="text-gray-600">min {minUsdc} · max {formatUsdc(maxMicro, { decimals: 0 })}</span>
              {tick != null && !!size && Number(size) > 0 && (
                <span className={clsx('font-medium', clears === false ? 'text-signal-stale' : 'text-signal-up')}>
                  {clears === null ? 'sits on the curve' : clears ? 'would clear at r* ✓' : 'outside r* — won’t clear yet'}
                </span>
              )}
            </div>
            <p className="text-[11px] text-gray-600 mt-1.5">Encrypted client-side to an eERC ciphertext; only the aggregate per tick is ever decrypted.</p>
          </div>

          {progress ? (
            <ProofState progress={progress} />
          ) : (
            <button onClick={submit} disabled={running || tick === null || !size} className="btn btn-primary w-full flex items-center justify-center gap-2">
              <Send className="w-4 h-4" /> Submit encrypted {side === 'ask' ? 'ask' : 'bid'}
            </button>
          )}
        </Card>

        <Card>
          <CardHeader title="My open bids this epoch" />
          {myBids.length === 0 ? (
            <p className="text-sm text-gray-600">No bids yet.</p>
          ) : (
            <div className="space-y-2">
              {myBids.slice(0, 6).map((b) => (
                <div key={b.id} className="flex items-center justify-between text-sm py-1.5 border-b border-white/[0.04] last:border-0">
                  <span className={b.side === 'ask' ? 'text-signal-up' : 'text-benchmark-300'}>{b.side === 'ask' ? 'ASK' : 'BID'}</span>
                  <span className="num text-white">{bpsToPctLabel(b.bps)}</span>
                  <EncryptedValue value={b.size} size="sm" />
                  <span className="text-[11px] text-gray-500">{b.status}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* live book */}
      <div className="space-y-5">
        <Card>
          <CardHeader
            title="Live aggregate depth"
            subtitle="What everyone sees while orders stream in"
            right={clock && <StatusPill status={clock.status} />}
          />
          {clock?.status === 'Open' && (
            <div className="text-xs mb-3">
              <Countdown targetMs={clock.closesAt} label="epoch closes in" />
            </div>
          )}
          <DepthChart depth={shownDepth} height={280} onPickRate={setTick} selectedTick={tick} orderSize={parsedSize} side={side} />
          <p className="text-[11px] text-gray-600 mt-2 text-center">Your rate shows as the gold line; the dot marks where your order lands on the curve.</p>
        </Card>
      </div>
    </div>
  );
}
