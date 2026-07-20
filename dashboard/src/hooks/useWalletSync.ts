import { useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useSessionStore } from '../stores/useSessionStore';
import type { Address } from '../lib/adapter/types';

// Syncs the wagmi wallet connection into the session store. A mock PersonaSwitcher
// selection (source='persona') coexists; the most recent action wins.
export function useWalletSync() {
  const { address, isConnected } = useAccount();
  const connect = useSessionStore((s) => s.connect);

  // Reflect a real browser-wallet connection into the session, IF one is ever wired up. The app
  // configures no wagmi connector today (see Web3Provider), so isConnected is always false and this
  // is a no-op. The old companion effect — disconnect() when source==='wallet' && !isConnected — was
  // removed: with no connector it fired on every custodial member and bounced them out on join.
  useEffect(() => {
    if (isConnected && address) connect(address as Address, 'wallet');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);
}
