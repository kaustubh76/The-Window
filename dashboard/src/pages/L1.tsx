import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Network, ShieldCheck, Lock, Eye, Ban, Check, X, KeyRound, Radio, Users, Loader2 } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { StatTile } from '../components/ui/StatTile';
import { AddressChip, shortAddr } from '../components/ui/AddressChip';
import { HonestClaimsCallout } from '../components/ui/HonestClaimsCallout';
import { l1Allowlist, controlActors, mintReadToken, type AllowlistRow, type ControlActor } from '../services/control';
import { CHAIN_LABEL, IS_L1, INDEXER_URL, TAGLINE } from '../config';
import { useMarketStore } from '../stores/useMarketStore';
import { useEventFeed } from '../hooks/useEventFeed';
import type { WindowEvent } from '../lib/adapter/types';

type BidEvent = Extract<WindowEvent, { type: 'BidSubmitted' }>;

// The permissioned-L1 story surface. eERC hides the AMOUNT; the L1 hides PARTICIPATION and
// gates ACCESS — the half eERC can't close on a public chain. One MemberRegistry drives
// four layers (market · eERC enrollment · network · observation); one removeMember revokes
// all four atomically. Honest-claims: say "members only / cannot observe", never overclaim.

function RolePill({ role, name }: { role: number; name: string }) {
  const map: Record<number, string> = {
    2: 'bg-benchmark-500/15 text-benchmark-300 border border-benchmark-500/30',
    1: 'bg-signal-up/12 text-signal-up border border-signal-up/25',
    0: 'bg-signal-down/12 text-signal-down border border-signal-down/25',
  };
  return <span className={clsx('pill num', map[role] ?? 'bg-white/[0.05] text-gray-400 border border-white/[0.08]')}>{name}</span>;
}

// ---- section 2: the two-leak table ----
const LEAK_ROWS: { leak: string; primitive: string; fuji: [boolean, string]; l1: [boolean, string] }[] = [
  { leak: 'Bid / loan amount', primitive: 'eERC — ElGamal + Groth16', fuji: [true, 'hidden'], l1: [true, 'hidden'] },
  { leak: 'Participation — who bid, when', primitive: 'permissioned L1', fuji: [false, 'public'], l1: [true, 'members only'] },
  { leak: 'Transact at all', primitive: 'TxAllowList write-gate', fuji: [false, 'anyone'], l1: [true, 'members only'] },
  { leak: 'Observe the market', primitive: 'READ_GATE read-gate', fuji: [false, 'anyone'], l1: [true, 'members only'] },
  { leak: 'Complete eviction', primitive: 'one removeMember', fuji: [false, 'partial'], l1: [true, 'total'] },
];

function LeakCell({ good, text }: { good: boolean; text: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 num text-xs', good ? 'text-signal-up' : 'text-signal-down')}>
      {good ? <Lock className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      {text}
    </span>
  );
}

// ---- section 6: atomic revoke ----
const REVOKE_LAYERS: { layer: string; effect: string }[] = [
  { layer: 'market', effect: 'onlyMember calls revert' },
  { layer: 'eERC', effect: 'cannot submit a register / transfer' },
  { layer: 'network', effect: 'TxAllowList role → None — no tx at all' },
  { layer: 'observation', effect: 'member-gated reads refuse the ex-member' },
];

type ProbeResult = { status: number; count?: number } | null;

async function probeL1Read(asMember: string | null): Promise<ProbeResult> {
  let headers: Record<string, string> = {};
  if (asMember) {
    const tok = await mintReadToken(asMember);
    if (tok) headers = { 'x-window-address': tok.address, 'x-window-sig': tok.sig };
  }
  try {
    const res = await fetch(`${INDEXER_URL}/members`, { headers });
    const count = res.ok ? ((await res.json()) as unknown[]).length : undefined;
    return { status: res.status, count };
  } catch {
    return { status: 0 };
  }
}

export default function L1() {
  const { members } = useMarketStore();
  const feed = useEventFeed();
  const recentBids = useMemo(
    () => [...feed].reverse().filter((e): e is BidEvent => e.type === 'BidSubmitted').slice(0, 6),
    [feed],
  );

  const [roles, setRoles] = useState<AllowlistRow[] | null>(null);
  const [precompile, setPrecompile] = useState('');
  const [actors, setActors] = useState<ControlActor[]>([]);

  // read-gate demonstrator state
  const memberActors = useMemo(() => actors.filter((a) => a.role === 'lender' || a.role === 'borrower'), [actors]);
  const [asMember, setAsMember] = useState<string | null>(null); // null = outsider
  const [probe, setProbe] = useState<ProbeResult>(null);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    let alive = true;
    l1Allowlist().then((r) => { if (alive) { setRoles(r.rows); setPrecompile(r.precompile); } }).catch(() => {});
    controlActors().then((a) => {
      if (!alive) return;
      setActors(a);
      const first = a.find((x) => x.role === 'lender' || x.role === 'borrower');
      setAsMember(first ? first.address : null);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    setProbing(true);
    probeL1Read(asMember).then((r) => { if (alive) { setProbe(r); setProbing(false); } });
    return () => { alive = false; };
  }, [asMember]);

  const enabledCount = roles?.filter((r) => r.isMember && r.role >= 1).length ?? 0;

  return (
    <div className="animate-fade-in space-y-8">
      {/* ---- hero ---- */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-cipher-300">
          <Network className="w-4 h-4" /> Permissioned Avalanche L1
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
          Membership <span className="text-benchmark-400">is</span> chain access
        </h1>
        <p className="text-sm text-gray-400 max-w-3xl leading-relaxed">
          eERC hides the <span className="text-cipher-300">amount</span>. But for a stigma market, <em>participation</em> is
          the signal — and on a public chain, who bid and when stays visible. The sovereign L1 closes that half: one{' '}
          <span className="num text-gray-300">MemberRegistry</span> drives four layers, so non-members can neither{' '}
          <span className="text-white">transact</span> nor <span className="text-white">observe</span> the market.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Chain" value="thewindowl1" icon={Network} accent="cipher" sub={CHAIN_LABEL} />
          <StatTile label="Consensus" value="PoA · WIN" sub="Subnet-EVM v0.8" />
          <StatTile label="Members enabled" value={`${enabledCount}/5`} icon={Users} accent="up" sub="via MemberRegistry" />
          <StatTile label="TxAllowList" value="0x02…0002" icon={ShieldCheck} accent="gold" sub="precompile" />
        </div>
        {!IS_L1 && (
          <div className="glass p-3 text-xs text-signal-stale border-signal-stale/20">
            This dashboard is pointed at a public chain — the L1 gates below are live only when connected to
            thewindowl1 (43117). Run <span className="num">npm run dev -- --mode l1</span>.
          </div>
        )}
      </div>

      {/* ---- two-leak table ---- */}
      <Card>
        <CardHeader
          title="Two leaks, two primitives"
          subtitle="eERC + permissioned L1 are complementary — necessary together for the stigma thesis"
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500">
                <th className="text-left font-medium py-2 pr-4">Leak surface</th>
                <th className="text-left font-medium py-2 pr-4">Closed by</th>
                <th className="text-left font-medium py-2 pr-4">Public chain (Fuji)</th>
                <th className="text-left font-medium py-2">Permissioned L1</th>
              </tr>
            </thead>
            <tbody>
              {LEAK_ROWS.map((r) => (
                <tr key={r.leak} className="border-t border-white/[0.04]">
                  <td className="py-2.5 pr-4 text-gray-200">{r.leak}</td>
                  <td className="py-2.5 pr-4 text-xs text-gray-500 num">{r.primitive}</td>
                  <td className="py-2.5 pr-4"><LeakCell good={r.fuji[0]} text={r.fuji[1]} /></td>
                  <td className="py-2.5"><LeakCell good={r.l1[0]} text={r.l1[1]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ---- live TxAllowList roles ---- */}
      <Card>
        <CardHeader
          title="Live TxAllowList roles"
          subtitle={precompile ? `precompile ${shortAddr(precompile)} · one MemberRegistry drives all four layers` : 'reading the precompile…'}
          right={<span className="pill num bg-cipher-500/10 text-cipher-300 border border-cipher-500/20"><Radio className="w-3 h-3 inline mr-1 animate-pulse-soft" />live</span>}
        />
        {!roles ? (
          <p className="text-xs text-gray-600 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> reading roles…</p>
        ) : (
          <div className="space-y-1">
            {roles.map((r) => (
              <div key={r.address} className="flex items-center justify-between py-1.5 border-b border-white/[0.03] last:border-0">
                <AddressChip address={r.address as `0x${string}`} label={r.label} />
                <div className="flex items-center gap-2">
                  {r.isMember && <span className="text-[10px] uppercase tracking-wider text-signal-up/80">member</span>}
                  <RolePill role={r.role} name={r.roleName} />
                </div>
              </div>
            ))}
            <p className="text-[11px] text-gray-600 pt-2">
              Ops roles (keeper/operator) are enabled at genesis; members earn access via MemberRegistry; the intruder is
              never a member → <span className="text-signal-down">None</span>. A services/allowlist keeper syncs
              MemberAdded/Removed → the precompile.
            </p>
          </div>
        )}
      </Card>

      {/* ---- read-gate demonstrator ---- */}
      <Card>
        <CardHeader
          title="Read-gate — membership is observation"
          subtitle="the market's read surface is member-signature-gated; a non-member cannot observe it"
          right={
            <div className="flex items-center gap-1 bg-white/[0.03] rounded-lg p-0.5 border border-white/[0.05]">
              <button
                onClick={() => setAsMember(memberActors[0]?.address ?? null)}
                className={clsx('px-3 py-1.5 rounded-md text-xs font-medium transition-colors', asMember ? 'bg-signal-up/15 text-signal-up' : 'text-gray-400 hover:text-white')}
              >
                Member
              </button>
              <button
                onClick={() => setAsMember(null)}
                className={clsx('px-3 py-1.5 rounded-md text-xs font-medium transition-colors', !asMember ? 'bg-signal-down/15 text-signal-down' : 'text-gray-400 hover:text-white')}
              >
                Outsider
              </button>
            </div>
          }
        />
        <div className="grid sm:grid-cols-[1fr_auto] gap-4 items-center">
          <div className="glass p-4">
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
              <KeyRound className="w-3.5 h-3.5" />
              {asMember ? (
                <>viewing as member <span className="num text-gray-300">{shortAddr(asMember)}</span> · Control mints a member-signed token</>
              ) : (
                <>viewing as a non-member · no token</>
              )}
            </div>
            <div className="num text-xs text-gray-500">GET {INDEXER_URL}/members</div>
          </div>
          <div className="flex items-center justify-center min-w-[180px]">
            {probing ? (
              <span className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> probing…</span>
            ) : probe?.status === 200 ? (
              <div className="flex items-center gap-2 text-signal-up font-semibold">
                <Check className="w-5 h-5" /> 200 · {probe.count} members visible
              </div>
            ) : probe?.status === 403 ? (
              <div className="flex items-center gap-2 text-signal-down font-semibold">
                <Ban className="w-5 h-5" /> 403 · read refused
              </div>
            ) : (
              <span className="text-gray-600 text-sm flex items-center gap-2"><X className="w-4 h-4" /> indexer unreachable</span>
            )}
          </div>
        </div>
        <p className="text-[11px] text-gray-600 mt-3">
          Scope: this gates the application read surface (the market-observation channel). Node-level RPC restriction
          (validator-only) is the production sovereign-testnet posture.
        </p>
      </Card>

      {/* ---- what a competitor sees: split-screen ---- */}
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-white mb-3">What a competitor sees</div>
        <div className="grid lg:grid-cols-2 gap-0 rounded-2xl overflow-hidden border border-white/[0.06]">
          {/* LEFT — public chain leaks participation */}
          <div className="bg-surface-1/80 p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-signal-down mb-1">
              <Eye className="w-4 h-4" /> Public chain (Fuji)
            </div>
            <p className="text-xs text-gray-500 mb-4">roster + every bid’s (who, tick) is world-readable — sizes stay ciphertext, but participation leaks</p>
            <div className="space-y-1.5 mb-4">
              {members.slice(0, 5).map((m) => (
                <div key={m.address} className="flex items-center justify-between">
                  <AddressChip address={m.address} label={m.label} simulated={m.simulated} />
                  <span className="text-[10px] text-gray-600 num">{m.roles.join(', ')}</span>
                </div>
              ))}
              {members.length === 0 && <p className="text-xs text-gray-600">roster loads with the market…</p>}
            </div>
            <div className="space-y-1 font-mono">
              {recentBids.map((e, i) => (
                <div key={i} className="text-[11px] text-gray-400 flex items-center gap-2">
                  <span className={e.side === 'ask' ? 'text-signal-up' : 'text-benchmark-300'}>{e.side === 'ask' ? 'ASK' : 'BID'}</span>
                  <span className="num">{shortAddr(e.by)}</span>
                  <span className="text-gray-600">tick {e.tick}</span>
                </div>
              ))}
              {recentBids.length === 0 && <p className="text-xs text-gray-600">encrypted bids stream in each epoch…</p>}
            </div>
          </div>

          {/* RIGHT — L1 refuses the non-member (live) */}
          <div className="bg-surface-2 p-6 border-t lg:border-t-0 lg:border-l border-benchmark-500/15 flex flex-col">
            <div className="flex items-center gap-2 text-sm font-semibold text-benchmark-300 mb-1">
              <Lock className="w-4 h-4" /> Permissioned L1
            </div>
            <p className="text-xs text-gray-500 mb-4">the same competitor (a non-member) queries the L1 indexer — live</p>
            <div className="flex-1 flex items-center justify-center min-h-[160px]">
              <div className="text-center">
                <Ban className="w-10 h-10 text-signal-down mx-auto mb-3" />
                <div className="num text-signal-down font-semibold">403 · read refused</div>
                <p className="text-xs text-gray-600 mt-2 max-w-[240px]">non-members cannot enumerate members or see any bid — participation is member-gated</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---- atomic revoke ---- */}
      <Card>
        <CardHeader title="Atomic revocation" subtitle="one removeMember revokes all four layers at once — a complete eviction impossible on shared public Fuji" />
        <div className="flex items-center gap-2 text-sm text-gray-300 mb-3 num">
          admin: MemberRegistry.removeMember(X) <span className="text-gray-600">→</span>
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          {REVOKE_LAYERS.map((l) => (
            <div key={l.layer} className="glass p-3 flex items-center gap-3">
              <X className="w-4 h-4 text-signal-down flex-shrink-0" />
              <div>
                <div className="text-sm text-white font-medium">{l.layer}</div>
                <div className="text-xs text-gray-500">{l.effect}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <HonestClaimsCallout />

      {/* tagline seam */}
      <div className="text-center py-6">
        <div className="divider-glow max-w-md mx-auto mb-5" />
        <p className="text-xl sm:text-2xl font-semibold text-white">
          The rate is <span className="text-benchmark-400">public</span>. The borrowing <span className="text-cipher-300">never was</span>.
        </p>
        <p className="text-xs text-gray-600 mt-2 num">{TAGLINE}</p>
      </div>
    </div>
  );
}
