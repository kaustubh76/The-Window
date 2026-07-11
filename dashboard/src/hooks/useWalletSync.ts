import { useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useSessionStore } from '../stores/useSessionStore';
import type { Address } from '../lib/adapter/types';

// Syncs the wagmi wallet connection into the session store. A mock PersonaSwitcher
// selection (source='persona') coexists; the most recent action wins.
export function useWalletSync() {
  const { address, isConnected } = useAccount();
  const connect = useSessionStore((s) => s.connect);
  const disconnect = useSessionStore((s) => s.disconnect);
  const source = useSessionStore((s) => s.source);

  useEffect(() => {
    if (isConnected && address) connect(address as Address, 'wallet');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);

  useEffect(() => {
    if (!isConnected && source === 'wallet') disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, source]);
}
