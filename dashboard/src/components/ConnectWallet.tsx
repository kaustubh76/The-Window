import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { LogOut, Wallet, Loader2, CheckCircle2, CircleDashed } from 'lucide-react';
import { useSessionStore } from '../stores/useSessionStore';
import { AddressChip } from './ui/AddressChip';
import PersonaSwitcher from './PersonaSwitcher';
import { ADAPTER_MODE } from '../config';
import type { Address } from '../lib/adapter/types';

function WalletButton() {
  const { connect, connectors, isPending } = useConnect();
  const c = connectors[0];
  return (
    <button onClick={() => c && connect({ connector: c })} disabled={isPending || !c} className="btn btn-primary flex items-center gap-2">
      {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
      {isPending ? 'Connecting…' : 'Connect wallet'}
    </button>
  );
}

export default function ConnectWallet() {
  const { address, label, registered, source, persona, disconnect: sessionDisconnect } = useSessionStore();
  const { isConnected } = useAccount();
  const { disconnect: wagmiDisconnect } = useDisconnect();

  const handleDisconnect = () => {
    if (source === 'wallet' && isConnected) wagmiDisconnect();
    sessionDisconnect();
  };

  if (!address) {
    return ADAPTER_MODE === 'mock' ? <PersonaSwitcher /> : <WalletButton />;
  }

  const roleLabel = label ?? (persona.includes('admin') ? 'Admin' : persona.includes('keeper') ? 'Keeper' : 'Member');

  return (
    <div className="flex items-center gap-2 animate-fade-in">
      <div className="flex items-center gap-2 glass px-3 py-1.5">
        <span
          className="inline-flex items-center gap-1 text-[11px]"
          title={registered ? 'Registered encryption key' : 'Not registered — register to encrypt'}
        >
          {registered ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-signal-up" />
          ) : (
            <CircleDashed className="w-3.5 h-3.5 text-signal-stale" />
          )}
        </span>
        <span className="text-sm text-white font-medium hidden sm:inline">{roleLabel}</span>
        <AddressChip address={address as Address} />
      </div>
      <button
        onClick={handleDisconnect}
        className="text-gray-500 hover:text-signal-down transition-colors p-2 rounded-lg hover:bg-signal-down/[0.06]"
        title="Disconnect"
      >
        <LogOut className="w-4 h-4" />
      </button>
    </div>
  );
}
