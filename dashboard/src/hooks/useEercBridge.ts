import { useEffect } from 'react';
import { useAdapterStore } from '../stores/useAdapterStore';
import { useSessionStore } from '../stores/useSessionStore';
import { setReadActor } from '../services/readAuth';

// Control bridge — the dashboard is a control + view surface. Writes are performed
// server-side by the Control API (services/control) using the proven eerc-node
// flows, so the browser holds no keys and needs no eERC SDK. This hook reflects the
// SESSION address (set by either the wallet-sync or the PersonaSwitcher actor picker)
// into the read-gate auth and refreshes registration once the adapter is up.
export function useEercBridge() {
  const init = useAdapterStore((s) => s.init);
  const address = useSessionStore((s) => s.address);
  useEffect(() => {
    let alive = true;
    // Reflect the actor into the read-gate auth, so gated L1 indexer reads carry a
    // member-signed token (Control-minted). No-op on Fuji (READ_GATED off).
    setReadActor(address);
    init().then((a) => {
      if (!alive || !a) return;
      // refresh registration/persona from the control balance once the adapter is ready
      if (address) void useSessionStore.getState().refreshRegistration();
    });
    return () => {
      alive = false;
    };
  }, [init, address]);
}
