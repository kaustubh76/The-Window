import clsx from 'clsx';
import { Lock, Coins, Banknote, Check, ShieldCheck, ArrowRight, AlertTriangle } from 'lucide-react';
import { Card } from './Card';
import { StatusPill } from './StatusPill';
import { EncryptedValue } from './EncryptedValue';
import { HealthMeter } from './HealthMeter';
import { Countdown } from './Countdown';
import { ProofState } from './ProofState';
import { TxLink } from './TxLink';
import { useAdapterStore } from '../../stores/useAdapterStore';
import { useUiStore } from '../../stores/useUiStore';
import { useClock } from '../../hooks/useClock';
import { useTx } from '../../hooks/useTx';
import { useToast } from '../../contexts/ToastContext';
import { bpsToPctLabel } from '../../lib/rates';
import { requiredCollateral, formatUsdc, microToNumber } from '../../lib/usdc';
import { isPendingStale } from '../../lib/loans';
import { HAIRCUT_BPS, HAIRCUT_PCT, timeProfile } from '../../config';
import type { Address, Loan } from '../../lib/adapter/types';

const YEAR_MS = 365 * 24 * 3600 * 1000;
const STAGES = ['Matched', 'Collateralized', 'Funded', 'Settled'] as const;

// Full-width, legible loan lifecycle: a 4-node stepper, the actual amounts (collateral
// required, repay est.), a live tenor bar + deadline, a clear "whose move" line, and the
// primary action (reuses the exact lock/fund/repay adapter calls + useTx/ProofState).
export function LoanLifecycle({ loan, myAddress }: { loan: Loan; myAddress: Address }) {
  const adapter = useAdapterStore((s) => s.adapter);
  const profile = useUiStore((s) => s.profile);
  const clock = useClock();
  const { run, progress, running } = useTx();
  const toast = useToast();
  const isBorrower = loan.borrower.toLowerCase() === myAddress.toLowerCase();
  const stale = isPendingStale(loan, clock?.epoch); // matched but never funded before the window closed

  const principal = loan.size.clear ?? null; // plaintext only when entitled
  const collReq = principal != null ? requiredCollateral(principal, HAIRCUT_BPS) : null;
  // Interest is NOT settled on-chain (SOFR-style benchmark); show an explicit ESTIMATE.
  // Tenor MATH uses the loan's real on-chain span so it's correct in live (chain-driven) too;
  // fall back to the profile tenor only before the loan is funded.
  const tenorMs =
    loan.fundedAt && loan.deadlineAt && loan.deadlineAt > loan.fundedAt
      ? loan.deadlineAt - loan.fundedAt
      : timeProfile(profile).tenorMs;
  const estInterest = principal != null ? BigInt(Math.round(microToNumber(principal) * (loan.rateBps / 10_000) * (tenorMs / YEAR_MS) * 1_000_000)) : null;

  // stage: Matched(0) → Collateralized(1) → Funded(2) → Settled/Seized(3)
  const stage =
    loan.status === 'Repaid' || loan.status === 'Defaulted' ? 3 : loan.status === 'Active' ? 2 : loan.collateral ? 1 : 0;
  const seized = loan.status === 'Defaulted';
  const nodes = seized ? (['Matched', 'Collateralized', 'Funded', 'Seized'] as const) : STAGES;

  // Turn raw LoanBook/Vault reverts into plain guidance (the tx carries only a custom-error selector).
  const friendlyLoanError = (e?: string) => {
    const s = (e || '').toLowerCase();
    if (s.includes('collateralnotlocked') || s.includes('not locked')) return 'Collateral is still being confirmed — try again in a moment.';
    if (s.includes('badstate')) return 'This loan isn’t in the right state (already funded or settled?).';
    if (s.includes('deadlinenotreached')) return 'The loan’s deadline hasn’t passed yet.';
    return e || 'Action failed';
  };

  const act = async (kind: 'coll' | 'fund' | 'repay') => {
    if (!adapter) return;
    const size = loan.size.clear ?? 0n;
    const res = await run((onP) => {
      if (kind === 'coll') return adapter.lockCollateral(loan.id, requiredCollateral(size, HAIRCUT_BPS), onP);
      if (kind === 'fund') return adapter.fund(loan.id, onP);
      return adapter.repay(loan.id, onP);
    });
    if (res.ok)
      toast.success(kind === 'coll' ? 'Collateral locked' : kind === 'fund' ? 'Loan funded' : 'Repaid — collateral released', res.txHash);
    else toast.error(friendlyLoanError(res.error));
  };

  // whose move
  const move = (() => {
    if (loan.status === 'Repaid') return { text: 'Repaid — collateral released', tone: 'up' as const };
    if (seized) return { text: 'Defaulted — collateral seized', tone: 'down' as const };
    if (loan.status === 'Active') return { text: 'Active — repay to settle', tone: 'you' as const };
    if (stale) return { text: 'Expired — funding window closed', tone: 'stale' as const };
    // Pending — the Control locks the borrower's collateral / funds via the auditor key, so any
    // member can advance a pending request (the lifecycle, not custody, is the point of the demo).
    if (!loan.collateral) return { text: 'Needs collateral — lock it to advance this request', tone: 'you' as const };
    return { text: 'Collateralized — ready to fund', tone: 'you' as const };
  })();

  // tenor progress (Active)
  const tenorPct =
    loan.status === 'Active' && loan.fundedAt && clock
      ? Math.min(100, Math.max(0, ((clock.now - loan.fundedAt) / tenorMs) * 100))
      : 0;

  return (
    <Card className="!p-5">
      {/* header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-benchmark-500/10 text-benchmark-400 flex items-center justify-center">
            {isBorrower ? <Banknote className="w-4 h-4" /> : <Coins className="w-4 h-4" />}
          </div>
          <div>
            <div className="text-sm font-semibold text-white num flex items-center gap-2">
              {loan.id} <span className="text-[11px] font-normal text-gray-500">{isBorrower ? 'you borrow' : 'you lend'} · epoch {loan.epoch}</span>
            </div>
            <div className="text-[11px] text-gray-500 num">rate {bpsToPctLabel(loan.rateBps)} · {timeProfile(profile).tenorLabel} tenor</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={loan.status} />
          {loan.createdTx && <TxLink hash={loan.createdTx} />}
        </div>
      </div>

      {/* stepper */}
      <div className="flex items-center mb-5">
        {nodes.map((label, i) => {
          const done = i < stage;
          const current = i === stage && loan.status !== 'Repaid' && !seized;
          const isSeizeNode = i === 3 && seized;
          return (
            <div key={label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={clsx(
                    'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-semibold',
                    isSeizeNode
                      ? 'bg-signal-down/15 text-signal-down'
                      : done || (i === 3 && loan.status === 'Repaid')
                        ? 'bg-signal-up/15 text-signal-up'
                        : current
                          ? 'bg-benchmark-500/15 text-benchmark-400 ring-2 ring-benchmark-500/30'
                          : 'bg-white/[0.04] text-gray-600',
                  )}
                >
                  {isSeizeNode ? <AlertTriangle className="w-3.5 h-3.5" /> : done || (i === 3 && loan.status === 'Repaid') ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </div>
                <span className={clsx('text-[10px] whitespace-nowrap', current ? 'text-white' : isSeizeNode ? 'text-signal-down' : 'text-gray-500')}>{label}</span>
              </div>
              {i < nodes.length - 1 && <div className={clsx('h-0.5 flex-1 mx-1.5 rounded-full', i < stage ? 'bg-signal-up/40' : 'bg-white/[0.06]')} />}
            </div>
          );
        })}
      </div>

      {/* amounts */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="glass px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Principal</div>
          <EncryptedValue value={loan.size} size="md" />
        </div>
        <div className="glass px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Collateral req · {HAIRCUT_PCT}%</div>
          <div className="num text-sm text-cipher-300 font-semibold">{collReq != null ? `${formatUsdc(collReq)}` : '—'}</div>
        </div>
        <div className="glass px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Repay (est.)</div>
          <div className="num text-sm text-benchmark-300 font-semibold">
            {principal != null ? formatUsdc(principal) : '—'}
            {estInterest != null && estInterest > 0n && <span className="text-gray-500"> + {formatUsdc(estInterest)}</span>}
          </div>
        </div>
      </div>

      {/* collateral health (borrower, once locked) */}
      {isBorrower && loan.collateral && (
        <div className="mb-4">
          <HealthMeter healthPct={loan.healthPct} />
        </div>
      )}

      {/* tenor progress + countdown (Active) */}
      {loan.status === 'Active' && (
        <div className="mb-4">
          <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div className="h-full bg-benchmark-500/60 transition-[width] duration-300 ease-linear" style={{ width: `${tenorPct}%` }} />
          </div>
          <div className="flex items-center justify-between mt-1.5 text-[11px]">
            <span className="text-gray-500">{Math.round(tenorPct)}% of tenor elapsed</span>
            <Countdown targetMs={loan.deadlineAt} label="deadline in" className="text-[11px]" />
          </div>
        </div>
      )}

      {/* whose-move + action */}
      <div className="flex items-center justify-between gap-3 pt-3 border-t border-white/[0.06]">
        <span
          className={clsx(
            'text-xs font-medium',
            move.tone === 'you' ? 'text-benchmark-300' : move.tone === 'up' ? 'text-signal-up' : move.tone === 'down' ? 'text-signal-down' : 'text-gray-500',
          )}
        >
          {move.text}
        </span>
        <div className="min-h-[34px] flex items-center flex-shrink-0">
          {stale ? (
            <span className="text-xs text-gray-500 inline-flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Request expired
            </span>
          ) : progress ? (
            <ProofState progress={progress} />
          ) : loan.status === 'Pending' && !loan.collateral ? (
            <button onClick={() => act('coll')} disabled={running} className="btn btn-primary text-xs !py-1.5 inline-flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" /> Lock collateral{collReq != null ? ` · ${formatUsdc(collReq)}` : ''}
            </button>
          ) : loan.status === 'Pending' && loan.collateral ? (
            <button onClick={() => act('fund')} disabled={running} className="btn btn-primary text-xs !py-1.5 inline-flex items-center gap-1.5">
              Fund loan <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : loan.status === 'Active' ? (
            <button onClick={() => act('repay')} disabled={running} className="btn btn-primary text-xs !py-1.5">
              Repay {principal != null ? formatUsdc(principal) : ''}
            </button>
          ) : null}
        </div>
      </div>

      {/* solvency-proof framing while locking */}
      {progress && loan.status === 'Pending' && !loan.collateral && (
        <p className="text-[11px] text-gray-600 mt-2 inline-flex items-center gap-1.5">
          <ShieldCheck className="w-3 h-3 text-cipher-300" /> proving collateral ≥ {HAIRCUT_PCT}% of the loan — without revealing either amount
        </p>
      )}
    </Card>
  );
}
