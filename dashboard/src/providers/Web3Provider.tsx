import { ReactNode } from 'react';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { avalancheFuji, localhost } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RPC_FUJI, RPC_LOCAL } from '../config';

// Avalanche Fuji + local Anvil. Mounted in all modes; the mock adapter ignores it,
// the live adapter reads through it. The browser NEVER holds the auditor key.
//
// The browser never signs/reads/writes through wagmi — all writes are server-side/custodial via the
// Control API and reads go through the indexer HTTP API. The old injected() connector + wagmi's
// default EIP-6963 (mipd) discovery only served to probe the wallet extension, which made its own
// inpage.js throw (ExtendedBroadcastMessage → addListener/emit on undefined). Drop both so the app
// makes zero contact with window.ethereum.
export const wagmiConfig = createConfig({
  chains: [avalancheFuji, localhost],
  connectors: [],
  multiInjectedProviderDiscovery: false,
  transports: {
    [avalancheFuji.id]: http(RPC_FUJI),
    [localhost.id]: http(RPC_LOCAL),
  },
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5_000 } },
});

export function Web3Provider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
