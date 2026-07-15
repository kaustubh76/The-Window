import { useEffect, useState } from 'react';
import { FlaskConical, Cpu, Gauge, KeyRound, Server } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { StatTile } from '../components/ui/StatTile';
import { useMarketStore } from '../stores/useMarketStore';
import { useAdapterStore } from '../stores/useAdapterStore';
import { ADAPTER_MODE, PROFILE, CHAIN_LABEL, IS_L1, RPC_FUJI, RPC_LOCAL, INDEXER_URL, ADDRESSES } from '../config';

const GATE = [
  { k: 'Homomorphic accumulate', v: '≈ 13k gas', note: 'per-tick Σ Enc(size) via BabyJubJub._add' },
  { k: 'PoCD verify (on-chain)', v: '≈ 266k gas', note: 'Groth16 verify, bound to on-chain accumulator' },
  { k: 'PoCD circuit', v: '≈ 12k constraints', note: 'single-sum; ptau 2^15' },
];

export default function Diagnostics() {
  const { history, loanBook, members } = useMarketStore();
  const adapter = useAdapterStore((s) => s.adapter);
  const [auditor, setAuditor] = useState<[string, string] | null>(null);

  useEffect(() => {
    // mock returns the pair synchronously; live returns a promise (control /auditor)
    const a = adapter as unknown as { auditorKey?: () => [string, string] | Promise<[string, string] | null> } | null;
    if (!a?.auditorKey) return;
    let alive = true;
    Promise.resolve(a.auditorKey()).then((k) => { if (alive && k) setAuditor(k); }).catch(() => {});
    return () => { alive = false; };
  }, [adapter]);

  const addrRows = Object.entries(ADDRESSES);

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Diagnostics</h1>
        <p className="text-gray-400 text-sm mt-1">Adapter, chain, and gate telemetry.</p>
      </div>

      {ADAPTER_MODE === 'mock' && (
        <div className="glass p-4 flex items-start gap-3 border-benchmark-500/15">
          <FlaskConical className="w-5 h-5 text-benchmark-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-gray-400">
            Running the <span className="text-benchmark-300 font-semibold">in-browser simulation</span> (DemoEngine). All members are
            simulated; ciphertexts are genuine ElGamal-over-BabyJubJub. No chain calls are made — flip <code className="num text-cipher-300">VITE_ADAPTER=live</code> to
            target deployed Fuji contracts.
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Adapter" value={ADAPTER_MODE} accent={ADAPTER_MODE === 'mock' ? 'gold' : 'cipher'} icon={Server} />
        <StatTile label="Profile" value={PROFILE} icon={Gauge} />
        <StatTile label="Epochs printed" value={history.length} accent="gold" icon={Cpu} />
        <StatTile label="Loans cycled" value={loanBook.length} accent="cipher" icon={Cpu} sub={`${members.length} members`} />
      </div>

      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Gauge className="w-4 h-4 text-benchmark-400" /> Gate metrics</span>} subtitle="Measured on the D2 feasibility gate" />
        <div className="space-y-2">
          {GATE.map((g) => (
            <div key={g.k} className="flex items-center justify-between py-1.5 border-b border-white/[0.04] last:border-0">
              <div>
                <div className="text-sm text-gray-300">{g.k}</div>
                <div className="text-xs text-gray-600">{g.note}</div>
              </div>
              <div className="num text-benchmark-300 font-semibold text-sm">{g.v}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-cipher-300" /> Auditor public key</span>} subtitle="BabyJubJub point the aggregates are encrypted to" />
        {auditor ? (
          <div className="num text-xs text-gray-400 space-y-1 break-all">
            <div>x: <span className="text-cipher-300">{auditor[0]}</span></div>
            <div>y: <span className="text-cipher-300">{auditor[1]}</span></div>
          </div>
        ) : (
          <p className="text-sm text-gray-600">Not available.</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Chain & contracts" subtitle={`${CHAIN_LABEL} · indexer ${INDEXER_URL}`} />
        <div className="text-xs num text-gray-500 mb-3 break-all">RPC: {IS_L1 ? RPC_LOCAL : RPC_FUJI}</div>
        <div className="space-y-1">
          {addrRows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-1 border-b border-white/[0.03] last:border-0">
              <span className="text-sm text-gray-400">{k}</span>
              <span className="num text-xs text-gray-500">{v || (ADAPTER_MODE === 'mock' ? 'simulated' : 'not deployed')}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
