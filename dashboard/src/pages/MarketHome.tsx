import { Link } from 'react-router-dom';
import { Activity, Layers, Users, Landmark, ArrowRight, Binary } from 'lucide-react';
import { useMarketStore } from '../stores/useMarketStore';
import { useSessionStore } from '../stores/useSessionStore';
import { JourneyStepper } from '../components/journey/JourneyStepper';
import { useClock } from '../hooks/useClock';
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
import { formatUsdcCompact } from '../lib/usdc';
import { bpsToPctLabel } from '../lib/rates';
import { TAGLINE } from '../config';

export default function MarketHome() {
  const clock = useClock();
  const { latestMonia, history, depth, members, loanBook } = useMarketStore();
  const connected = useSessionStore((s) => !!s.address);

  const active = loanBook.filter((l) => l.status === 'Active').length;
  const repaid = loanBook.filter((l) => l.status === 'Repaid').length;
  const defaulted = loanBook.filter((l) => l.status === 'Defaulted').length;

  // While a fresh epoch is still filling, show the last printed depth so the chart is never blank.
  const hasLiveBids = depth.some((d) => d.supply > 0n || d.demand > 0n);
  const shownDepth = hasLiveBids ? depth : latestMonia?.depth ?? [];

  // Skeleton only during the sub-second adapter init (clock null), never during the honest
  // pre-first-print period (clock present, rate "—").
  if (!clock) {
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
            <Link to="/app" className="btn btn-primary w-full flex items-center justify-center gap-2 mt-1">
              {connected ? 'Go to your desk' : 'Enter the market'} <ArrowRight className="w-4 h-4" />
            </Link>
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
            right={latestMonia && <PoCDBadge pocd={latestMonia.pocd} compact />}
          />
          <DepthChart depth={shownDepth} />
        </Card>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Clearing rate" value={latestMonia?.rStarBps != null ? bpsToPctLabel(latestMonia.rStarBps) : '—'} accent="gold" icon={Activity} />
            <StatTile label="Epoch volume" value={latestMonia ? formatUsdcCompact(latestMonia.aggVolume) : '—'} icon={Layers} sub="USDC" />
            <StatTile label="Active loans" value={active} accent="cipher" icon={Landmark} sub={`${repaid} repaid · ${defaulted} seized`} />
            <StatTile label="Members" value={members.length} icon={Users} sub="all simulated" />
          </div>
          <Card>
            <CardHeader title="Recent prints" />
            <div className="space-y-1.5 max-h-[168px] overflow-y-auto">
              {history.length === 0 && <p className="text-sm text-gray-600">Waiting for the first print…</p>}
              {[...history].reverse().slice(0, 8).map((p) => (
                <div key={p.epoch} className="flex items-center justify-between text-sm py-1 border-b border-white/[0.03] last:border-0">
                  <span className="num text-gray-500">epoch {p.epoch}</span>
                  <span className="num text-benchmark-400 font-semibold">
                    {p.rStarBps != null ? bpsToPctLabel(p.rStarBps) : 'no-trade'}
                  </span>
                  <span className="num text-xs text-gray-600">{formatUsdcCompact(p.aggVolume)}</span>
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
