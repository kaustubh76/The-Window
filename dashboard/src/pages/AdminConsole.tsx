import { useState } from 'react';
import { KeyRound, Calculator, ShieldCheck, Send, GitMerge, Check, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { Card } from '../components/ui/Card';
import { ProofState } from '../components/ui/ProofState';
import { PoCDBadge } from '../components/ui/PoCDBadge';
import { HonestClaimsCallout } from '../components/ui/HonestClaimsCallout';
import { useClock } from '../hooks/useClock';
import { useAdapterStore } from '../stores/useAdapterStore';
import { useTx } from '../hooks/useTx';
import { useToast } from '../contexts/ToastContext';
import { bpsToPctLabel } from '../lib/rates';
import { formatUsdcCompact, formatVolume } from '../lib/usdc';
import type { DepthPoint, MoniaPrint } from '../lib/adapter/types';

export default function AdminConsole() {
  const clock = useClock();
  const adapter = useAdapterStore((s) => s.adapter);
  const printTx = useTx();
  const toast = useToast();

  const [epoch, setEpoch] = useState<number | null>(null);
  const [depth, setDepth] = useState<DepthPoint[] | null>(null);
  const [rStar, setRStar] = useState<number | null | undefined>(undefined);
  const [print, setPrint] = useState<MoniaPrint | null>(null);
  const [matches, setMatches] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null); // which non-proof step is running

  const target = epoch ?? clock?.epoch ?? 0;

  // Surface the REAL backend error (was a generic "Decrypt failed" that hid the cause), and
  // translate the two expected live conditions into plain guidance: the free admin service
  // waking/busy, and a manual print racing the autonomous keeper (epoch already printed).
  const errMsg = (e: unknown, fallback: string) => {
    const m = (e instanceof Error ? e.message : String(e ?? '')).trim();
    if (/already printed|alreadyprinted|not closed|epoch not/i.test(m)) return 'Epoch already handled by the keeper — target a closed-but-unprinted epoch.';
    if (/failed to fetch|networkerror|control .*failed|\b50[023]\b|timeout|timed out|econn/i.test(m)) return 'Admin service is waking or busy — give it a few seconds and retry.';
    return m || fallback;
  };

  const step1 = async () => {
    if (!adapter) return;
    setBusy(1); setEpoch(target);
    try { const d = await adapter.adminDecryptAggregates(target); setDepth(d); toast.info(`Decrypted ${d.length} tick aggregates for epoch ${target}`); }
    catch (e) { toast.error(errMsg(e, 'Decrypt failed')); }
    finally { setBusy(null); }
  };
  const step2 = async () => {
    if (!adapter) return;
    setBusy(2);
    try { const { rStarBps } = await adapter.adminComputeClearing(target); setRStar(rStarBps); }
    catch (e) { toast.error(errMsg(e, 'Compute failed')); }
    finally { setBusy(null); }
  };
  const step3 = async () => {
    if (!adapter) return;
    const res = await printTx.run((onP) => adapter.adminPostPrint(target, onP));
    if (res.ok) {
      setPrint(res.print);
      toast.success(`M-ONIA printed: ${res.print.rStarBps != null ? bpsToPctLabel(res.print.rStarBps) : 'no-trade'}`, res.txHash);
    } else {
      toast.error(errMsg(res.error, 'Print failed'));
    }
  };
  const step4 = async () => {
    if (!adapter) return;
    setBusy(4);
    try { const res = await adapter.adminPostMatches(target); setMatches(res.loans.length); toast.success(`Posted ${res.loans.length} matches`); }
    catch (e) { toast.error(errMsg(e, 'Post matches failed')); }
    finally { setBusy(null); }
  };

  const Step = ({ n, title, icon: Icon, done, children, onRun, runLabel, disabled, busy: stepBusy }: {
    n: number; title: string; icon: typeof KeyRound; done: boolean; children?: React.ReactNode; onRun?: () => void; runLabel: string; disabled?: boolean; busy?: boolean;
  }) => (
    <Card className={clsx('!p-4', done && 'border-signal-up/20')}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center', done ? 'bg-signal-up/15 text-signal-up' : 'bg-benchmark-500/10 text-benchmark-400')}>
            {done ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
          </div>
          <div>
            <div className="text-[11px] text-gray-500 num">step {n}</div>
            <div className="text-sm font-semibold text-white">{title}</div>
          </div>
        </div>
        {onRun && (
          <button onClick={onRun} disabled={disabled || stepBusy} className="btn btn-secondary text-xs !py-1.5 inline-flex items-center gap-1.5">
            {stepBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {runLabel}
          </button>
        )}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </Card>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Administrator console</h1>
        <p className="text-gray-400 text-sm mt-1">Decrypt aggregates, compute the clearing rate, and print M-ONIA with a proof of correct decryption.</p>
      </div>

      <div className="glass p-3 flex items-center gap-3">
        <span className="text-xs text-gray-500">Target epoch</span>
        <span className="num text-benchmark-300 font-semibold">#{target}</span>
        <span className="text-xs text-gray-600 ml-auto">clock: epoch #{clock?.epoch} · {clock?.status}</span>
      </div>

      <Step n={1} title="Decrypt per-tick aggregates" icon={KeyRound} done={!!depth} onRun={step1} runLabel="Decrypt" busy={busy === 1} disabled={busy !== null}>
        {depth && (
          <div className="max-h-40 overflow-y-auto text-xs num">
            <div className="grid grid-cols-3 gap-2 text-gray-500 pb-1 border-b border-white/[0.06]">
              <span>rate</span><span>supply</span><span>demand</span>
            </div>
            {depth.filter((d) => d.supply > 0n || d.demand > 0n).map((d) => (
              <div key={d.tick} className="grid grid-cols-3 gap-2 py-0.5">
                <span className="text-gray-400">{bpsToPctLabel(d.bps)}</span>
                <span className="text-signal-up">{formatUsdcCompact(d.supply)}</span>
                <span className="text-benchmark-300">{formatUsdcCompact(d.demand)}</span>
              </div>
            ))}
          </div>
        )}
      </Step>

      <Step n={2} title="Compute uniform clearing rate r*" icon={Calculator} done={rStar !== undefined} onRun={step2} runLabel="Compute" busy={busy === 2} disabled={!depth || busy !== null}>
        {rStar !== undefined && (
          <div className="text-sm">
            {rStar === null ? (
              <span className="text-signal-stale">No crossing — epoch prints “no trade”.</span>
            ) : (
              <span className="rate-print text-2xl">{bpsToPctLabel(rStar)}</span>
            )}
          </div>
        )}
      </Step>

      <Step n={3} title="Generate PoCD & post print" icon={ShieldCheck} done={!!print} onRun={step3} runLabel="Print M-ONIA" disabled={rStar === undefined || printTx.running}>
        {printTx.progress && <ProofState progress={printTx.progress} />}
        {print && (
          <div className="flex items-center gap-3">
            <span className="rate-print text-xl">{print.rStarBps != null ? bpsToPctLabel(print.rStarBps) : 'no-trade'}</span>
            <PoCDBadge pocd={print.pocd} />
            <span className="text-xs text-gray-500 num">vol {formatVolume(print)}</span>
          </div>
        )}
      </Step>

      <Step n={4} title="Post matches to LoanBook" icon={GitMerge} done={matches !== null} onRun={step4} runLabel="Post matches" busy={busy === 4} disabled={!print || busy !== null}>
        {matches !== null && <span className="text-sm text-signal-up">✓ {matches} loans created (no plaintext size on-chain)</span>}
      </Step>

      <div className="glass p-4 border-benchmark-500/15">
        <div className="flex items-center gap-2 text-sm font-semibold text-benchmark-300 mb-2">
          <Send className="w-4 h-4" /> What you publish
        </div>
        <p className="text-sm text-gray-400">Only the aggregate depth curve and the clearing rate — each bound to on-chain ciphertexts by the PoCD. Never individual sizes.</p>
        <div className="mt-3"><HonestClaimsCallout compact /></div>
      </div>
    </div>
  );
}
