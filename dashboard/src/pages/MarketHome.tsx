import { Link, useNavigate } from 'react-router-dom';
import { Activity, Layers, Users, Landmark, ArrowRight, Binary, FlaskConical, MousePointerClick } from 'lucide-react';
import { useMarketStore } from '../stores/useMarketStore';
import { useSessionStore } from '../stores/useSessionStore';
import { JourneyStepper } from '../components/journey/JourneyStepper';
import { useClock } from '../hooks/useClock';
import { useToast } from '../contexts/ToastContext';
import { Card, CardHeader } from '../components/ui/Card';
import { StatTile } from '../components/ui/StatTile';
import { MoniaTicker } from '../components/ui/MoniaTicker';
import { DepthChart } from '../components/ui/DepthChart';
import { Countdown } from '../components/ui/Countdown';
import { StatusPill } from '../components/ui/StatusPill';
import { PoCDBadge } from '../components/ui/PoCDBadge';
import { HonestClaimsCallout } from '../components/ui/HonestClaimsCallout';
import { LiveTxFeed } from '../components/ui/LiveTxFeed';
import { MarketHeroSkeleton } from '../components/ui/Skeleton';
import { formatVolume } from '../lib/usdc';
import { bpsToPctLabel, tickToBps } from '../lib/rates';
import { TAGLINE } from '../config';
import { paletteHint } from '../components/CommandPalette';
import type { TickIndex } from '../lib/adapter/types';

const openPersonaPicker = () => window.dispatchEvent(new Event('personapicker:open'));

export default function MarketHome() {
  const clock = useClock();
  const navigate = useNavigate();
  const toast = useToast();
  const { latestMonia, history, depth, members, loanBook } = useMarketStore();
  const connected = useSessionStore((s) => !!s.address);

  // Clicking a rate on the public hero chart is an invitation to trade there: connected users
  // deep-link into the auction with that tick preselected; disconnected users are nudged to
  // pick a persona first (so the chart stops being a passive read-out).
  const onHeroPickRate = (t: TickIndex) => {
    const bps = tickToBps(t);
    if (connected) navigate(`/app/auction?rate=${bps}`);
    else {
      toast.info(`Pick a persona to place an order at ${bpsToPctLabel(bps)}`);
      openPersonaPicker();
    }
  };

  const active = loanBook.filter((l) => l.status === 'Active').length;
  const repaid = loanBook.filter((l) => l.status === 'Repaid').length;
  const defaulted = loanBook.filter((l) => l.status === 'Defaulted').length;

  // While a fresh epoch is still filling, show the last printed depth so the chart is never blank.
  const hasLiveBids = depth.some((d) => d.supply > 0n || d.demand > 0n);
  const shownDepth = hasLiveBids ? depth : latestMonia?.depth ?? [];

  // Skeleton during the sub-second adapter init (clock null) AND while the indexer is still cold —
  // a cold/backfilling indexer serves epochLenMs:0 (no real clock yet), which the adapter would
  // otherwise paint as a dead "#0 Open, rate —" hero. epochLenMs is >0 for any genuine epoch, so
  // this never masks the honest pre-first-print period (real Open epoch, rate "—").
  if (!clock || clock.epochLenMs === 0) {
    return (
      <div className="animate-fade-in">
        <MarketHeroSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Thesis strip — the "why" for cold judges */}
      <p className="text-center text-sm text-gray-500 max-w-2xl mx-auto">
        <span className="text-gray-300">Observable borrowing kills lending markets.</span> THE WINDOW settles in
        ciphertext — only the rate is public.{' '}
        <Link to="/methodology" className="text-benchmark-400 hover:text-benchmark-300 whitespace-nowrap">
          Why →
        </Link>
      </p>

      {/* Start here — the disconnected first-timer's guided entry (interactive pieces live
          behind the connect gate, so surface the one-click way in right on the landing). */}
      {!connected && (
        <Card className="!p-5 border-benchmark-500/20 bg-benchmark-500/[0.03] animate-fade-in-up">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-benchmark-500/15 text-benchmark-300 flex items-center justify-center flex-shrink-0">
              <FlaskConical className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-white">Start trading in one click</h2>
              <p className="text-sm text-gray-400 mt-0.5">
                Play as a simulated lender or borrower — no wallet, no keys needed. We’ll walk you through it.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={openPersonaPicker} className="btn btn-primary inline-flex items-center gap-2">
                Choose who to play as <ArrowRight className="w-4 h-4" />
              </button>
              <span className="hidden lg:inline text-[11px] text-gray-600 num">or {paletteHint}</span>
            </div>
          </div>
        </Card>
      )}

      {/* Hero */}
      <Card shine className="!p-7">
        <div className="grid lg:grid-cols-[1.6fr_1fr] gap-6 items-center">
          <MoniaTicker latest={latestMonia} history={history} />
          <div className="lg:border-l lg:border-white/[0.06] lg:pl-6 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-gray-500">Current epoch</span>
              {clock && <StatusPill status={clock.status} />}
            </div>
            <div className="text-3xl font-bold num text-white">#{clock?.epoch ?? '—'}</div>
            {clock && (
              <div className="text-sm text-gray-400">
                {clock.status === 'Open' ? (
                  <Countdown targetMs={clock.closesAt} label="closes in" />
                ) : clock.status === 'Closed' ? (
                  <span className="text-signal-stale">closed · awaiting print</span>
                ) : (
                  <span className="text-benchmark-400">printed ✓</span>
                )}
              </div>
            )}
            <p className="text-sm text-gray-500 italic pt-2 border-t border-white/[0.06]">“{TAGLINE}”</p>
            {connected ? (
              <Link to="/app" className="btn btn-primary w-full flex items-center justify-center gap-2 mt-1">
                Go to your desk <ArrowRight className="w-4 h-4" />
              </Link>
            ) : (
              <button onClick={openPersonaPicker} className="btn btn-primary w-full flex items-center justify-center gap-2 mt-1">
                <FlaskConical className="w-4 h-4" /> Choose who to play as
              </button>
            )}
            <Link to="/explorer" className="btn btn-outline w-full flex items-center justify-center gap-2">
              <Binary className="w-4 h-4" /> Open Explorer
            </Link>
          </div>
        </div>
      </Card>

      {/* Your next step (only once you've stepped into a persona) */}
      {connected && <JourneyStepper compact />}

      {/* Depth + side rail */}
      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-6">
        <Card>
          <CardHeader
            title="Aggregate depth curve"
            subtitle="Cumulative supply vs demand — the only size data shown publicly"
            right={
              <div className="flex items-center gap-2">
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-gray-600">
                  <MousePointerClick className="w-3 h-3" /> click a rate to trade there
                </span>
                {latestMonia && <PoCDBadge pocd={latestMonia.pocd} compact />}
              </div>
            }
          />
          <DepthChart depth={shownDepth} onPickRate={onHeroPickRate} />
        </Card>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Clearing rate" value={latestMonia?.rStarBps != null ? bpsToPctLabel(latestMonia.rStarBps) : '—'} accent="gold" icon={Activity} />
            <StatTile label="Epoch volume" value={latestMonia ? formatVolume(latestMonia) : '—'} icon={Layers} sub="USDC" />
            <StatTile label="Active loans" value={active} accent="cipher" icon={Landmark} sub={`${repaid} repaid · ${defaulted} seized`} />
            <StatTile label="Members" value={members.length} icon={Users} sub="all simulated" />
          </div>
          <Card>
            <CardHeader title="Recent prints" />
            <div className="space-y-1.5 max-h-[168px] overflow-y-auto">
              {history.length === 0 && (
                <div className="flex items-center justify-between text-sm py-1">
                  <span className="text-gray-500">First print lands when the epoch closes</span>
                  {clock?.status === 'Open' ? (
                    <Countdown targetMs={clock.closesAt} label="in" className="text-xs" />
                  ) : (
                    <span className="text-signal-stale text-xs">printing…</span>
                  )}
                </div>
              )}
              {[...history].reverse().slice(0, 8).map((p) => (
                <div key={p.epoch} className="flex items-center justify-between text-sm py-1 border-b border-white/[0.03] last:border-0">
                  <span className="num text-gray-500">epoch {p.epoch}</span>
                  <span className="num text-benchmark-400 font-semibold">
                    {p.rStarBps != null ? bpsToPctLabel(p.rStarBps) : 'no-trade'}
                  </span>
                  <span className="num text-xs text-gray-600">{formatVolume(p)}</span>
                </div>
              ))}
            </div>
          </Card>
          <HonestClaimsCallout compact />
        </div>
      </div>

      {/* On-chain activity feed — real Fuji txs + Snowtrace links when live; honestly
          framed as simulated in the default mock build (LiveTxFeed gates on ADAPTER_MODE) */}
      <LiveTxFeed />

      <div className="flex justify-center">
        <Link to="/methodology" className="text-sm text-gray-500 hover:text-benchmark-400 transition-colors inline-flex items-center gap-1.5">
          How M-ONIA is computed <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}
