import { ReactNode } from 'react';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { avalancheFuji, localhost } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RPC_FUJI, RPC_LOCAL } from '../config';

// Avalanche Fuji + local Anvil. Mounted in all modes; the mock adapter ignores it,
// the live adapter reads through it. The browser NEVER holds the auditor key.
export const wagmiConfig = createConfig({
  chains: [avalancheFuji, localhost],
  connectors: [injected()],
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
