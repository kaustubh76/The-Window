import { useEffect } from 'react';
import { useAccount } from 'wagmi';
import { ADAPTER_MODE } from '../config';
import { useAdapterStore } from '../stores/useAdapterStore';
import type { LiveAdapter } from '../lib/adapter/live/LiveAdapter';

// Control bridge — in live mode the dashboard is a control + view surface. Writes are
// performed server-side by the Control API (services/control) using the proven
// eerc-node flows, so the browser holds no keys and needs no eERC SDK. This hook just
// reflects the connected wallet / selected persona into the LiveAdapter so session +
// member ops act as that address.
export function useEercBridge() {
  const init = useAdapterStore((s) => s.init);
  const { address } = useAccount();
  useEffect(() => {
    if (ADAPTER_MODE !== 'live') return;
    let alive = true;
    init().then((a) => {
      if (!alive || !a || a.mode !== 'live') return;
      (a as unknown as LiveAdapter).setActor((address ?? null) as `0x${string}` | null);
    });
    return () => { alive = false; };
  }, [init, address]);
}
