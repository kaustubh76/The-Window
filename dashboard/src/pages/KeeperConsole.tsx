import { useState } from 'react';
import { Timer, Gavel, AlertTriangle, Loader2 } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { StatusPill } from '../components/ui/StatusPill';
import { Countdown } from '../components/ui/Countdown';
import { EncryptedValue } from '../components/ui/EncryptedValue';
import { useMarketStore } from '../stores/useMarketStore';
import { useClock } from '../hooks/useClock';
import { useAdapterStore } from '../stores/useAdapterStore';
import { useToast } from '../contexts/ToastContext';
import { AddressChip } from '../components/ui/AddressChip';
import { bpsToPctLabel } from '../lib/rates';

export default function KeeperConsole() {
  const clock = useClock();
  const { loanBook, members } = useMarketStore();
  const adapter = useAdapterStore((s) => s.adapter);
  const toast = useToast();

  const active = loanBook.filter((l) => l.status === 'Active');
  const now = clock?.now ?? 0;
  const [closing, setClosing] = useState(false);
  const [seizing, setSeizing] = useState<string | null>(null);

  const closeEpoch = async () => {
    if (!adapter || !clock) return;
    setClosing(true);
    try { const res = await adapter.closeEpoch(clock.epoch); toast.success(`Closed epoch ${clock.epoch}`, res.txHash); }
    catch { toast.error('Close failed'); }
    finally { setClosing(false); }
  };
  const seize = async (id: string) => {
    if (!adapter) return;
    setSeizing(id);
    try { const res = await adapter.seize(id); toast.success(`Seized collateral for ${id}`, res.txHash); }
    catch { toast.error('Seize failed'); }
    finally { setSeizing(null); }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Keeper console</h1>
        <p className="text-gray-400 text-sm mt-1">Permissionless: close epochs at the window end, seize loans past their deadline block.</p>
      </div>

      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Gavel className="w-4 h-4 text-benchmark-400" /> Close epoch</span>}
          subtitle={`Epoch #${clock?.epoch} · ${clock?.status}`}
          right={clock && <StatusPill status={clock.status} />}
        />
        {clock?.status === 'Open' ? (
          <div className="flex items-center gap-3">
            <button onClick={closeEpoch} disabled={closing} className="btn btn-primary inline-flex items-center gap-2">
              {closing && <Loader2 className="w-4 h-4 animate-spin" />} {closing ? 'Closing…' : 'Close epoch now'}
            </button>
            <Countdown targetMs={clock.closesAt} label="auto-closes in" className="text-sm" />
          </div>
        ) : (
          <p className="text-sm text-gray-500">Epoch already closed — the administrator prints M-ONIA next.</p>
        )}
      </Card>

      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Timer className="w-4 h-4 text-cipher-300" /> Deadline watcher</span>}
          subtitle="Active loans; seize is enabled only past the deadline block"
        />
        {active.length === 0 ? (
          <p className="text-sm text-gray-600">No active loans.</p>
        ) : (
          <div className="space-y-2">
            {active.map((l) => {
              const overdue = now >= l.deadlineAt;
              return (
                <div key={l.id} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                  <div className="flex items-center gap-3">
                    <span className="num text-sm text-white">{l.id}</span>
                    <span className="num text-xs text-benchmark-300">{bpsToPctLabel(l.rateBps)}</span>
                    <EncryptedValue value={l.size} size="sm" />
                  </div>
                  <div className="flex items-center gap-3">
                    <Countdown targetMs={l.deadlineAt} label="deadline" className="text-xs" />
                    <button
                      onClick={() => seize(l.id)}
                      disabled={!overdue || seizing === l.id}
                      className="btn btn-secondary text-xs !py-1.5 flex items-center gap-1.5 disabled:opacity-40"
                      title={overdue ? 'Seize collateral' : 'Not yet past deadline'}
                    >
                      {seizing === l.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />} Seize
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Members" subtitle="Vetted allowlist (all simulated)" />
        <div className="space-y-1.5">
          {members.map((m) => (
            <div key={m.address} className="flex items-center justify-between text-sm py-1">
              <AddressChip address={m.address} label={m.label} simulated={m.simulated} />
              <span className="text-[11px] text-gray-500">{m.roles.join(', ')}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
