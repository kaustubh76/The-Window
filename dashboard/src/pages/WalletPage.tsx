import { useState } from 'react';
import { Droplet, KeyRound, ArrowDownUp, Wallet, ShieldCheck, Loader2 } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { StatTile } from '../components/ui/StatTile';
import { EncryptedValue } from '../components/ui/EncryptedValue';
import { RevealButton } from '../components/ui/RevealButton';
import { AmountInput } from '../components/ui/AmountInput';
import { ProofState } from '../components/ui/ProofState';
import { HonestClaimsCallout } from '../components/ui/HonestClaimsCallout';
import { Term } from '../components/ui/Term';
import { usePositionsStore } from '../stores/usePositionsStore';
import { useSessionStore } from '../stores/useSessionStore';
import { useAdapterStore } from '../stores/useAdapterStore';
import { useTx } from '../hooks/useTx';
import { useToast } from '../contexts/ToastContext';
import { parseUsdc, formatUsdc } from '../lib/usdc';
import type { Address } from '../lib/adapter/types';

export default function WalletPage() {
  const address = useSessionStore((s) => s.address) as Address;
  const registered = useSessionStore((s) => s.registered);
  const setRegistered = useSessionStore((s) => s.setRegistered);
  const { balances, revealed } = usePositionsStore();
  const adapter = useAdapterStore((s) => s.adapter);
  const toast = useToast();

  const regTx = useTx();
  const wrapTx = useTx();
  const unwrapTx = useTx();
  const [wrapAmt, setWrapAmt] = useState('');
  const [unwrapAmt, setUnwrapAmt] = useState('');
  const [funding, setFunding] = useState(false);

  const doRegister = async () => {
    if (!adapter) return;
    const res = await regTx.run((onP) => adapter.register(address, onP));
    if (res.ok) {
      setRegistered(true);
      toast.success('Registered — your encryption key is ready', res.txHash);
    }
  };
  const doFaucet = async () => {
    if (!adapter) return;
    setFunding(true);
    try { const res = await adapter.faucet(address, 1000_000000n); toast.success('+1,000 TestUSDC', res.txHash); }
    catch { toast.error('Faucet failed'); }
    finally { setFunding(false); }
  };
  const doWrap = async () => {
    if (!adapter) return;
    let micro: bigint;
    try {
      micro = parseUsdc(wrapAmt);
    } catch {
      toast.error('Invalid amount');
      return;
    }
    const res = await wrapTx.run((onP) => adapter.wrap(address, micro, onP));
    if (res.ok) {
      toast.success(`Wrapped ${wrapAmt} USDC → encrypted`, res.txHash);
      setWrapAmt('');
    } else toast.error(res.error ?? 'Wrap failed');
  };
  const doUnwrap = async () => {
    if (!adapter) return;
    let micro: bigint;
    try {
      micro = parseUsdc(unwrapAmt);
    } catch {
      toast.error('Invalid amount');
      return;
    }
    const res = await unwrapTx.run((onP) => adapter.unwrap(address, micro, onP));
    if (res.ok) {
      toast.success(`Unwrapped ${unwrapAmt} USDC`, res.txHash);
      setUnwrapAmt('');
    } else toast.error(res.error ?? 'Unwrap failed');
  };
  const doReveal = async () => {
    if (!adapter) return;
    const v = await adapter.decryptOwnBalance(address);
    usePositionsStore.getState().setRevealed(v);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Wallet</h1>
        <p className="text-gray-400 text-sm mt-1">Fund, register your encryption key, and wrap into encrypted eERC.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatTile label="TestUSDC (public)" value={balances ? formatUsdc(balances.usdcErc20) : '—'} icon={Wallet} sub="ERC-20" />
        <StatTile
          label="Encrypted eERC"
          value={revealed !== null ? formatUsdc(revealed) : <EncryptedValue value={balances?.eercEncrypted} size="lg" suffix="" />}
          accent="cipher"
          icon={ShieldCheck}
          sub={revealed !== null ? 'revealed locally' : 'visible only to you'}
        />
      </div>

      {/* Step 1 — register */}
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-benchmark-400" /> Encryption key</span>}
          subtitle={<>Register once to derive your <Term k="bjj">BabyJubJub key</Term> — required before wrapping or bidding</>}
          right={registered ? <span className="pocd-badge num">registered</span> : null}
        />
        {registered ? (
          <p className="text-sm text-signal-up">✓ Registered — you can wrap and bid.</p>
        ) : regTx.progress ? (
          <ProofState progress={regTx.progress} />
        ) : (
          <button onClick={doRegister} disabled={regTx.running} className="btn btn-primary flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> Register (generate proof)
          </button>
        )}
      </Card>

      {/* Step 2 — faucet + wrap */}
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Droplet className="w-4 h-4 text-cipher-300" /> Fund & wrap</span>} subtitle={<>Get TestUSDC, then <Term k="wrap">wrap</Term> it into your encrypted balance</>} />
        <div className="flex items-center gap-2 mb-4">
          <button onClick={doFaucet} disabled={funding} className="btn btn-secondary flex items-center gap-2">
            {funding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Droplet className="w-4 h-4" />} Faucet +1,000
          </button>
          <span className="text-xs text-gray-500">Public balance: <span className="num text-white">{balances ? formatUsdc(balances.usdcErc20) : '—'}</span></span>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <AmountInput
              value={wrapAmt}
              onChange={setWrapAmt}
              max={balances?.usdcErc20 ?? null}
              placeholder="Amount to wrap"
              disabled={!registered}
              preview={wrapAmt ? `Wrap ${wrapAmt} USDC into your encrypted balance` : undefined}
            />
          </div>
          <button onClick={doWrap} disabled={!registered || wrapTx.running || !wrapAmt} className="btn btn-primary">
            Wrap →
          </button>
        </div>
        {!registered && <p className="text-xs text-signal-stale mt-2">Register first to get your encryption key.</p>}
        {wrapTx.progress && <div className="mt-2"><ProofState progress={wrapTx.progress} /></div>}
      </Card>

      {/* Step 3 — reveal + unwrap */}
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><ArrowDownUp className="w-4 h-4 text-benchmark-400" /> Encrypted balance</span>}
          subtitle="Decrypt locally (your key), or unwrap back to TestUSDC"
          right={revealed === null ? <RevealButton onReveal={doReveal} /> : null}
        />
        <div className="text-2xl font-bold num mb-4">
          {revealed !== null ? (
            <span className="text-cipher-300">{formatUsdc(revealed)} <span className="text-gray-500 text-sm">USDC</span></span>
          ) : (
            <EncryptedValue value={balances?.eercEncrypted} size="lg" />
          )}
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <AmountInput
              value={unwrapAmt}
              onChange={setUnwrapAmt}
              max={revealed ?? balances?.eercClear ?? null}
              placeholder="Amount to unwrap"
              preview={unwrapAmt ? `Unwrap ${unwrapAmt} back to public TestUSDC` : undefined}
            />
          </div>
          <button onClick={doUnwrap} disabled={unwrapTx.running || !unwrapAmt} className="btn btn-secondary">
            ← Unwrap (proof)
          </button>
        </div>
        {unwrapTx.progress && <div className="mt-2"><ProofState progress={unwrapTx.progress} /></div>}
      </Card>

      <HonestClaimsCallout compact />
    </div>
  );
}
