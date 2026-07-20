import { useAccount, useDisconnect } from 'wagmi';
import { LogOut, CheckCircle2, CircleDashed, FlaskConical } from 'lucide-react';
import { useSessionStore } from '../stores/useSessionStore';
import { AddressChip } from './ui/AddressChip';
import type { Address } from '../lib/adapter/types';

export default function ConnectWallet() {
  const { address, label, registered, source, persona, disconnect: sessionDisconnect } = useSessionStore();
  const { isConnected } = useAccount();
  const { disconnect: wagmiDisconnect } = useDisconnect();

  const handleDisconnect = () => {
    if (source === 'wallet' && isConnected) wagmiDisconnect();
    sessionDisconnect();
  };

  if (!address) {
    // One connect entry everywhere: open the shared PersonaPicker modal (mounted in Layout).
    // The picker onboards a real member or steps into one of the Control API's actor EOAs
    // (a real browser wallet can't be a Control actor — Control holds the keys).
    return (
      <button
        onClick={() => window.dispatchEvent(new Event('personapicker:open'))}
        className="btn btn-primary flex items-center gap-2"
      >
        <FlaskConical className="w-4 h-4" /> Connect as
      </button>
    );
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
