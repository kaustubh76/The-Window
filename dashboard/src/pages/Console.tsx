import { Link } from 'react-router-dom';
import { Wallet, Gavel, Landmark, ArrowRight, ShieldCheck } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { StatTile } from '../components/ui/StatTile';
import { EncryptedValue } from '../components/ui/EncryptedValue';
import { RevealButton } from '../components/ui/RevealButton';
import { Countdown } from '../components/ui/Countdown';
import { StatusPill } from '../components/ui/StatusPill';
import { usePositionsStore } from '../stores/usePositionsStore';
import { useMarketStore } from '../stores/useMarketStore';
import { useSessionStore } from '../stores/useSessionStore';
import { useAdapterStore } from '../stores/useAdapterStore';
import { useClock } from '../hooks/useClock';
import { formatUsdc } from '../lib/usdc';
import { bpsToPctLabel } from '../lib/rates';
import type { Address } from '../lib/adapter/types';

const quick = [
  { to: '/app/wallet', label: 'Wallet', desc: 'Faucet · register · wrap', icon: Wallet },
  { to: '/app/auction', label: 'Auction', desc: 'Submit encrypted bids', icon: Gavel },
  { to: '/app/positions', label: 'Positions', desc: 'Loans · collateral · repay', icon: Landmark },
];

export default function Console() {
  const address = useSessionStore((s) => s.address) as Address;
  const label = useSessionStore((s) => s.label);
  const registered = useSessionStore((s) => s.registered);
  const { balances, revealed, myBids, myLoans } = usePositionsStore();
  const { latestMonia } = useMarketStore();
  const adapter = useAdapterStore((s) => s.adapter);
  const clock = useClock();

  const doReveal = async () => {
    if (!adapter) return;
    usePositionsStore.getState().setRevealed(await adapter.decryptOwnBalance(address));
  };

  const activeLoans = myLoans.filter((l) => l.status === 'Active' || l.status === 'Pending');

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{label ?? 'Console'}</h1>
          <p className="text-gray-400 text-sm mt-1">
            {registered ? 'Registered ✓' : 'Not registered — set up your encryption key in Wallet.'}
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

      <div className="grid sm:grid-cols-3 gap-3">
        <StatTile label="TestUSDC" value={balances ? formatUsdc(balances.usdcErc20) : '—'} icon={Wallet} sub="public" />
        <div className="glass px-4 py-3">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">
            <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Encrypted eERC</span>
            {revealed === null && <RevealButton onReveal={doReveal} />}
          </div>
          <div className="text-xl font-bold num text-cipher-300">
            {revealed !== null ? `${formatUsdc(revealed)}` : <EncryptedValue value={balances?.eercEncrypted} size="lg" suffix="" />}
          </div>
        </div>
        <StatTile label="M-ONIA" value={latestMonia?.rStarBps != null ? bpsToPctLabel(latestMonia.rStarBps) : '—'} accent="gold" sub="clearing rate" />
      </div>

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

      <div className="grid sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Open bids" right={<Link to="/app/auction" className="text-xs text-benchmark-400 hover:text-benchmark-300">Auction →</Link>} />
          {myBids.length === 0 ? (
            <p className="text-sm text-gray-600">No open bids.</p>
          ) : (
            <div className="space-y-1.5">
              {myBids.slice(0, 4).map((b) => (
                <div key={b.id} className="flex items-center justify-between text-sm">
                  <span className={b.side === 'ask' ? 'text-signal-up' : 'text-benchmark-300'}>{b.side === 'ask' ? 'ASK' : 'BID'}</span>
                  <span className="num text-white">{bpsToPctLabel(b.bps)}</span>
                  <EncryptedValue value={b.size} size="sm" />
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Open loans" right={<Link to="/app/positions" className="text-xs text-benchmark-400 hover:text-benchmark-300">Positions →</Link>} />
          {activeLoans.length === 0 ? (
            <p className="text-sm text-gray-600">No open loans.</p>
          ) : (
            <div className="space-y-1.5">
              {activeLoans.slice(0, 4).map((l) => (
                <div key={l.id} className="flex items-center justify-between text-sm">
                  <span className="num text-gray-400">{l.id}</span>
                  <span className="num text-benchmark-300">{bpsToPctLabel(l.rateBps)}</span>
                  <StatusPill status={l.status} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
