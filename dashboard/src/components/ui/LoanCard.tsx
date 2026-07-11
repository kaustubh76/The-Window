import { Lock, Coins, Banknote, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Card } from './Card';
import { StatusPill } from './StatusPill';
import { EncryptedValue } from './EncryptedValue';
import { HealthMeter } from './HealthMeter';
import { Countdown } from './Countdown';
import { ProofState } from './ProofState';
import { useAdapterStore } from '../../stores/useAdapterStore';
import { useTx } from '../../hooks/useTx';
import { useToast } from '../../contexts/ToastContext';
import { bpsToPctLabel } from '../../lib/rates';
import { requiredCollateral } from '../../lib/usdc';
import { HAIRCUT_BPS } from '../../config';
import type { Address, Loan } from '../../lib/adapter/types';

export function LoanCard({ loan, myAddress }: { loan: Loan; myAddress: Address }) {
  const adapter = useAdapterStore((s) => s.adapter);
  const { run, progress, running } = useTx();
  const toast = useToast();
  const isBorrower = loan.borrower.toLowerCase() === myAddress.toLowerCase();

  const act = async (kind: 'coll' | 'fund' | 'repay') => {
    if (!adapter) return;
    const size = loan.size.clear ?? 0n;
    const res = await run((onP) => {
      if (kind === 'coll') return adapter.lockCollateral(loan.id, requiredCollateral(size, HAIRCUT_BPS), onP);
      if (kind === 'fund') return adapter.fund(loan.id, onP);
      return adapter.repay(loan.id, onP);
    });
    if (res.ok) toast.success(kind === 'coll' ? 'Collateral locked' : kind === 'fund' ? 'Loan funded' : 'Repaid — collateral released');
  };

  return (
    <Card className="!p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-benchmark-500/10 text-benchmark-400 flex items-center justify-center">
            {isBorrower ? <Banknote className="w-4 h-4" /> : <Coins className="w-4 h-4" />}
          </div>
          <div>
            <div className="text-sm font-semibold text-white num">{loan.id}</div>
            <div className="text-[11px] text-gray-500">
              {isBorrower ? 'You borrow' : 'You lend'} · epoch {loan.epoch}
            </div>
          </div>
        </div>
        <StatusPill status={loan.status} />
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm mb-3">
        <div>
          <div className="text-[11px] text-gray-500 mb-0.5">Principal</div>
          <EncryptedValue value={loan.size} />
        </div>
        <div>
          <div className="text-[11px] text-gray-500 mb-0.5">Rate</div>
          <span className="num text-benchmark-300 font-semibold">{bpsToPctLabel(loan.rateBps)}</span>
        </div>
      </div>

      {isBorrower && (
        <div className="mb-3">
          {loan.collateral ? <HealthMeter healthPct={loan.healthPct} /> : <span className="text-xs text-gray-600">No collateral locked yet</span>}
        </div>
      )}

      {loan.status === 'Active' && (
        <div className="text-xs mb-3">
          <Countdown targetMs={loan.deadlineAt} label="deadline in" />
          <span className="text-gray-600 ml-2">· 6h tenor · compressed</span>
        </div>
      )}

      {/* actions */}
      <div className="min-h-[34px] flex items-center">
        {progress ? (
          <ProofState progress={progress} />
        ) : loan.status === 'Pending' && isBorrower && !loan.collateral ? (
          <button onClick={() => act('coll')} disabled={running} className="btn btn-primary text-xs !py-1.5 flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" /> Lock collateral (solvency proof)
          </button>
        ) : loan.status === 'Pending' && !isBorrower && loan.collateral ? (
          <button onClick={() => act('fund')} disabled={running} className="btn btn-primary text-xs !py-1.5">
            Fund loan (encrypted transfer)
          </button>
        ) : loan.status === 'Pending' ? (
          <span className="text-xs text-gray-500">{isBorrower ? 'Awaiting lender funding…' : 'Awaiting borrower collateral…'}</span>
        ) : loan.status === 'Active' && isBorrower ? (
          <button onClick={() => act('repay')} disabled={running} className="btn btn-primary text-xs !py-1.5">
            Repay now (P + interest)
          </button>
        ) : loan.status === 'Active' ? (
          <span className="text-xs text-cipher-300">Funded · awaiting repayment</span>
        ) : loan.status === 'Repaid' ? (
          <span className="text-xs text-signal-up flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> Repaid · collateral released
          </span>
        ) : (
          <span className="text-xs text-signal-down flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Defaulted · collateral seized
          </span>
        )}
      </div>
    </Card>
  );
}
