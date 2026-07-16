import { useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { KeyRound, Droplet, ArrowDownUp, Gavel, Landmark, Plug, Check, ArrowRight, Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ProofState } from '../ui/ProofState';
import { AmountInput } from '../ui/AmountInput';
import { useSessionStore } from '../../stores/useSessionStore';
import { usePositionsStore } from '../../stores/usePositionsStore';
import { useAdapterStore } from '../../stores/useAdapterStore';
import { useTx } from '../../hooks/useTx';
import { useToast } from '../../contexts/ToastContext';
import { parseUsdc, formatUsdc } from '../../lib/usdc';
import type { Address } from '../../lib/adapter/types';

type StepKey = 'connect' | 'register' | 'fund' | 'wrap' | 'bid' | 'track';
interface Step {
  key: StepKey;
  icon: LucideIcon;
  title: string;
  desc: string;
  done: boolean;
  to?: string; // steps whose action is "go to another page"
}

// The guided borrow/lend journey. Reads live session + position state, always surfaces the
// NEXT action inline. Reuses the exact register/faucet/wrap adapter calls (see WalletPage)
// and the useTx + ProofState feedback pattern.
export function JourneyStepper({ compact = false }: { compact?: boolean }) {
  const address = useSessionStore((s) => s.address) as Address | null;
  const registered = useSessionStore((s) => s.registered);
  const setRegistered = useSessionStore((s) => s.setRegistered);
  const { balances, revealed, myBids, myLoans } = usePositionsStore();
  const adapter = useAdapterStore((s) => s.adapter);
  const toast = useToast();

  const regTx = useTx();
  const wrapTx = useTx();
  const [funding, setFunding] = useState(false);
  const [wrapAmt, setWrapAmt] = useState('');

  const publicUsdc = balances?.usdcErc20 ?? 0n;
  const hasUsdc = publicUsdc > 0n;
  const hasEncrypted = (revealed != null && revealed > 0n) || (balances?.eercClear != null && balances.eercClear > 0n);

  const steps: Step[] = [
    { key: 'connect', icon: Plug, title: 'Connect', desc: 'Step into a member persona', done: !!address },
    { key: 'register', icon: KeyRound, title: 'Register your key', desc: 'Derive your BabyJubJub encryption key', done: registered },
    { key: 'fund', icon: Droplet, title: 'Get test USDC', desc: 'Faucet 1,000 TestUSDC to your wallet', done: hasUsdc || hasEncrypted },
    { key: 'wrap', icon: ArrowDownUp, title: 'Wrap to encrypted eERC', desc: 'Move USDC into your private balance', done: hasEncrypted },
    { key: 'bid', icon: Gavel, title: 'Place a bid', desc: 'Lend or borrow at a public rate — size stays encrypted', done: myBids.length > 0, to: '/app/auction' },
    { key: 'track', icon: Landmark, title: 'Track & repay', desc: 'Collateralize, fund, repay your loans', done: myLoans.length > 0, to: '/app/positions' },
  ];
  const firstOpen = steps.findIndex((s) => !s.done);
  const currentIdx = firstOpen === -1 ? steps.length - 1 : firstOpen;
  const allDone = firstOpen === -1;

  // ---- inline actions (reused from WalletPage) ----
  const doRegister = async () => {
    if (!adapter || !address) return;
    const res = await regTx.run((onP) => adapter.register(address, onP));
    if (res.ok) { setRegistered(true); toast.success('Registered — encryption key ready', res.txHash); }
    else toast.error(res.error ?? 'Register failed');
  };
  const doFaucet = async () => {
    if (!adapter || !address) return;
    setFunding(true);
    try { const res = await adapter.faucet(address, 1000_000000n); toast.success('+1,000 TestUSDC', res.txHash); }
    catch { toast.error('Faucet failed'); }
    finally { setFunding(false); }
  };
  const doWrap = async () => {
    if (!adapter || !address) return;
    let micro: bigint;
    try { micro = parseUsdc(wrapAmt); } catch { toast.error('Invalid amount'); return; }
    if (micro <= 0n) { toast.error('Enter an amount'); return; }
    const res = await wrapTx.run((onP) => adapter.wrap(address, micro, onP));
    if (res.ok) { toast.success(`Wrapped ${wrapAmt} USDC → encrypted`, res.txHash); setWrapAmt(''); }
    else toast.error(res.error ?? 'Wrap failed');
  };

  // ---- compact: just the next step + a CTA (landing page) ----
  if (compact) {
    const cur = steps[currentIdx];
    const CurIcon = cur.icon;
    return (
      <Link to="/app" className="glass p-3 flex items-center gap-3 hover:bg-white/[0.04] transition-colors group">
        <div className="w-9 h-9 rounded-lg bg-benchmark-500/10 text-benchmark-400 flex items-center justify-center flex-shrink-0">
          {allDone ? <Check className="w-4 h-4 text-signal-up" /> : <CurIcon className="w-4 h-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-gray-500">{allDone ? 'You’re set up' : `Next step ${currentIdx + 1}/${steps.length}`}</div>
          <div className="text-sm text-white font-medium truncate">{allDone ? 'Manage your positions' : cur.title}</div>
        </div>
        <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-benchmark-400 group-hover:translate-x-0.5 transition-all" />
      </Link>
    );
  }

  // ---- full stepper (the Desk hero) ----
  const renderAction = (key: StepKey) => {
    switch (key) {
      case 'register':
        return regTx.progress ? <ProofState progress={regTx.progress} /> : (
          <button onClick={doRegister} disabled={regTx.running} className="btn btn-primary inline-flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> Register (generate proof)
          </button>
        );
      case 'fund':
        return (
          <button onClick={doFaucet} disabled={funding} className="btn btn-primary inline-flex items-center gap-2">
            {funding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Droplet className="w-4 h-4" />} Faucet +1,000 USDC
          </button>
        );
      case 'wrap':
        return wrapTx.progress ? <ProofState progress={wrapTx.progress} /> : (
          <div className="space-y-2 max-w-sm">
            <AmountInput
              value={wrapAmt}
              onChange={setWrapAmt}
              max={publicUsdc}
              placeholder="Amount to wrap"
              preview={wrapAmt ? `Wrap ${wrapAmt} USDC into your encrypted balance` : `Public balance: ${formatUsdc(publicUsdc)} USDC`}
            />
            <button onClick={doWrap} disabled={wrapTx.running || !wrapAmt} className="btn btn-primary inline-flex items-center gap-2">
              <ArrowDownUp className="w-4 h-4" /> Wrap to encrypted
            </button>
          </div>
        );
      case 'bid':
        return <Link to="/app/auction" className="btn btn-primary inline-flex items-center gap-2"><Gavel className="w-4 h-4" /> Place a bid</Link>;
      case 'track':
        return <Link to="/app/positions" className="btn btn-primary inline-flex items-center gap-2"><Landmark className="w-4 h-4" /> View positions</Link>;
      default:
        return null;
    }
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white tracking-tight">Get started</h3>
          <p className="text-xs text-gray-500 mt-0.5">{allDone ? 'Setup complete — you’re trading.' : 'Lend or borrow in a few guided steps.'}</p>
        </div>
        <span className="pill num bg-white/[0.05] text-gray-400 border border-white/[0.08]">
          {steps.filter((s) => s.done).length}/{steps.length}
        </span>
      </div>
      <ol className="space-y-1">
        {steps.map((s, i) => {
          const StepIcon = s.icon;
          const isCurrent = i === currentIdx && !allDone;
          return (
            <li
              key={s.key}
              className={clsx(
                'rounded-xl border transition-colors',
                isCurrent ? 'border-benchmark-500/25 bg-benchmark-500/[0.04] p-4' : 'border-transparent px-4 py-2.5',
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={clsx(
                    'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
                    s.done ? 'bg-signal-up/15 text-signal-up' : isCurrent ? 'bg-benchmark-500/15 text-benchmark-400' : 'bg-white/[0.04] text-gray-600',
                  )}
                >
                  {s.done ? <Check className="w-4 h-4" /> : <StepIcon className="w-4 h-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={clsx('text-sm font-medium flex items-center gap-2', s.done ? 'text-gray-400' : isCurrent ? 'text-white' : 'text-gray-500')}>
                    {s.title}
                    {s.done && <span className="text-[10px] uppercase tracking-wider text-signal-up/70">done</span>}
                  </div>
                  {(isCurrent || (!s.done && !isCurrent)) && <div className="text-xs text-gray-500 mt-0.5">{s.desc}</div>}
                  {isCurrent && <div className="mt-3">{renderAction(s.key)}</div>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
