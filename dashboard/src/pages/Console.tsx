import { Link, useNavigate } from 'react-router-dom';
import { Wallet, Gavel, Landmark, ArrowRight, ShieldCheck, Layers, Users, MousePointerClick } from 'lucide-react';
import { JourneyStepper } from '../components/journey/JourneyStepper';
import { Card, CardHeader } from '../components/ui/Card';
import { StatTile } from '../components/ui/StatTile';
import { EncryptedValue } from '../components/ui/EncryptedValue';
import { RevealButton } from '../components/ui/RevealButton';
import { Countdown } from '../components/ui/Countdown';
import { StatusPill, SideBadge } from '../components/ui/StatusPill';
import { DepthChart } from '../components/ui/DepthChart';
import { DepthLadder } from '../components/ui/DepthLadder';
import { PoCDBadge } from '../components/ui/PoCDBadge';
import { LoanCard } from '../components/ui/LoanCard';
import { LiveTxFeed } from '../components/ui/LiveTxFeed';
import { Term } from '../components/ui/Term';
import { usePositionsStore } from '../stores/usePositionsStore';
import { useMarketStore } from '../stores/useMarketStore';
import { useSessionStore } from '../stores/useSessionStore';
import { useAdapterStore } from '../stores/useAdapterStore';
import { useClock } from '../hooks/useClock';
import { isPendingStale } from '../lib/loans';
import { formatUsdc, formatVolume } from '../lib/usdc';
import { bpsToPctLabel, tickToBps } from '../lib/rates';
import type { Address, TickIndex } from '../lib/adapter/types';

const quick = [
  { to: '/app/wallet', label: 'Wallet', desc: 'Faucet · register · wrap', icon: Wallet },
  { to: '/app/auction', label: 'Auction', desc: 'Submit encrypted bids', icon: Gavel },
  { to: '/app/positions', label: 'Positions', desc: 'Loans · collateral · repay', icon: Landmark },
];

export default function Console() {
  const navigate = useNavigate();
  const address = useSessionStore((s) => s.address) as Address;
  const label = useSessionStore((s) => s.label);
  const registered = useSessionStore((s) => s.registered);
  const { balances, revealed, myBids, myLoans } = usePositionsStore();
  const { latestMonia, depth, members, loanBook } = useMarketStore();
  const adapter = useAdapterStore((s) => s.adapter);
  const clock = useClock();

  const doReveal = async () => {
    if (!adapter) return;
    usePositionsStore.getState().setRevealed(await adapter.decryptOwnBalance(address));
  };

  // Clicking a rate on the desk's book/chart deep-links into the order ticket with that tick preset.
  const goTrade = (t: TickIndex) => navigate(`/app/auction?rate=${tickToBps(t)}`);

  const activeLoans = myLoans.filter((l) => l.status === 'Active' || (l.status === 'Pending' && !isPendingStale(l, clock?.epoch)));
  // `myBids` is the member's whole bid history; "open bids" means the CURRENT auction only, so scope
  // to clock.epoch (past-epoch bids are matched/expired). Newest-first.
  const openBids = clock ? myBids.filter((b) => b.epoch === clock.epoch) : [];

  // Market-wide context (already hydrated globally by useMarketData) — the desk surfaces it so a
  // member can read the book before pricing their next order, instead of flying blind.
  const active = loanBook.filter((l) => l.status === 'Active').length;
  const repaid = loanBook.filter((l) => l.status === 'Repaid').length;
  const defaulted = loanBook.filter((l) => l.status === 'Defaulted').length;
  // While a fresh epoch is still filling, fall back to the last printed depth so the book is never blank.
  const hasLiveBids = depth.some((d) => d.supply > 0n || d.demand > 0n);
  const shownDepth = hasLiveBids ? depth : latestMonia?.depth ?? [];

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Your Desk</h1>
          <p className="text-gray-400 text-sm mt-1">
            {label ? <span className="text-gray-300">{label}</span> : null}
            {label ? ' · ' : ''}
            {registered ? <span className="text-signal-up">key registered ✓</span> : 'follow the steps below to start trading'}
          </p>
        </div>
        {clock && (
          <div className="text-right">
            <div className="flex items-center gap-2 justify-end mb-1">
              <span className="text-xs text-gray-500">epoch #{clock.epoch}</span>
              <StatusPill status={clock.status} />
            </div>
            {clock.status === 'Open' && <Countdown targetMs={clock.closesAt} label="closes in" className="text-sm" />}
          </div>
        )}
      </div>

      {/* Guided journey — collapses to a compact strip once the member's key is registered */}
      <JourneyStepper compact={registered} />

      {/* Your balances */}
      <div className="grid sm:grid-cols-3 gap-3">
        <StatTile label="TestUSDC" value={balances ? formatUsdc(balances.usdcErc20) : '—'} icon={Wallet} sub="public" />
        <div className="glass px-4 py-3">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">
            <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Encrypted <Term k="eerc" /></span>
            {revealed === null && <RevealButton onReveal={doReveal} />}
          </div>
          <div className="text-xl font-bold num text-cipher-300">
            {revealed !== null ? `${formatUsdc(revealed)}` : <EncryptedValue value={balances?.eercEncrypted} size="lg" suffix="" />}
          </div>
        </div>
        <StatTile label="M-ONIA" value={latestMonia?.rStarBps != null ? bpsToPctLabel(latestMonia.rStarBps) : '—'} accent="gold" sub="clearing rate" />
      </div>

      {/* Market band — depth curve + order-book ladder, the live context for pricing an order */}
      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-6 items-start">
        <Card>
          <CardHeader
            title="Aggregate depth"
            subtitle="Cumulative supply vs demand — the only size data shown publicly"
            right={latestMonia ? <PoCDBadge pocd={latestMonia.pocd} compact /> : undefined}
          />
          <DepthChart depth={shownDepth} onPickRate={goTrade} />
        </Card>
        <Card>
          <CardHeader
            title="Order book"
            subtitle="Aggregate size per rate · r* highlighted"
            right={<span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-gray-600"><MousePointerClick className="w-3 h-3" /> click to trade</span>}
          />
          <DepthLadder depth={shownDepth} onPickRate={goTrade} />
        </Card>
      </div>

      {/* Market stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Epoch volume" value={latestMonia ? formatVolume(latestMonia) : '—'} icon={Layers} sub="USDC cleared" />
        <StatTile label="Active loans" value={active} accent="cipher" icon={Landmark} sub={`${repaid} repaid · ${defaulted} seized`} />
        <StatTile label="Members" value={members.length} icon={Users} sub="registered on-chain" />
        <StatTile label="My open bids" value={openBids.length} accent="gold" icon={Gavel} sub={`${activeLoans.length} active loan${activeLoans.length === 1 ? '' : 's'}`} />
      </div>

      {/* Your positions */}
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Card>
          <CardHeader
            title="My open bids"
            subtitle="this epoch"
            right={<Link to="/app/auction" className="text-xs text-benchmark-400 hover:text-benchmark-300">Auction →</Link>}
          />
          {openBids.length === 0 ? (
            <Link to="/app/auction" className="text-sm text-gray-500 hover:text-benchmark-400 inline-flex items-center gap-1.5">
              No open bids — place an encrypted order <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          ) : (
            <div className="space-y-2">
              {[...openBids].reverse().map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-2 glass px-3 py-2">
                  <SideBadge side={b.side} />
                  <span className="num text-white">{bpsToPctLabel(b.bps)}</span>
                  <EncryptedValue value={b.size} size="sm" />
                  <span className="text-[10px] uppercase tracking-wider text-gray-500">{b.status}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs uppercase tracking-wider text-gray-500">My loans</span>
            <Link to="/app/positions" className="text-xs text-benchmark-400 hover:text-benchmark-300">All positions →</Link>
          </div>
          {activeLoans.length === 0 ? (
            <Card>
              <Link to="/app/auction" className="text-sm text-gray-500 hover:text-benchmark-400 inline-flex items-center gap-1.5">
                No open loans — bid to borrow or lend <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </Card>
          ) : (
            activeLoans.slice(0, 2).map((l) => <LoanCard key={l.id} loan={l} myAddress={address} />)
          )}
        </div>
      </div>

      {/* Quick links */}
      <div className="grid sm:grid-cols-3 gap-3">
        {quick.map((q) => {
          const Icon = q.icon;
          return (
            <Link key={q.to} to={q.to} className="card card-hover card-shine group">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-benchmark-500/10 text-benchmark-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Icon className="w-5 h-5" />
                </div>
                <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-benchmark-400 group-hover:translate-x-1 transition-all" />
              </div>
              <div className="text-white font-semibold">{q.label}</div>
              <div className="text-xs text-gray-500">{q.desc}</div>
            </Link>
          );
        })}
      </div>

      {/* On-chain activity — real Fuji txs + Snowtrace links */}
      <LiveTxFeed />
    </div>
  );
}
