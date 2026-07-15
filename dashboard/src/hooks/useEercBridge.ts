import { useEffect } from 'react';
import { ADAPTER_MODE } from '../config';
import { useAdapterStore } from '../stores/useAdapterStore';
import { useSessionStore } from '../stores/useSessionStore';
import { setReadActor } from '../services/readAuth';
import type { LiveAdapter } from '../lib/adapter/live/LiveAdapter';

// Control bridge — in live mode the dashboard is a control + view surface. Writes are
// performed server-side by the Control API (services/control) using the proven eerc-node
// flows, so the browser holds no keys and needs no eERC SDK. This hook reflects the
// SESSION address (set by either the wallet-sync or the PersonaSwitcher actor picker) into
// the LiveAdapter, so session + member/admin/keeper ops act as that Control actor.
export function useEercBridge() {
  const init = useAdapterStore((s) => s.init);
  const address = useSessionStore((s) => s.address);
  useEffect(() => {
    if (ADAPTER_MODE !== 'live') return;
    let alive = true;
    // Reflect the actor into the read-gate auth too, so gated L1 indexer reads carry a
    // member-signed token (Control-minted). No-op on Fuji (READ_GATED off).
    setReadActor(address);
    init().then((a) => {
      if (!alive || !a || a.mode !== 'live') return;
      (a as unknown as LiveAdapter).setActor(address);
      // refresh registration/persona from the control balance once the actor is set
      if (address) void useSessionStore.getState().refreshRegistration();
    });
    return () => {
      alive = false;
    };
  }, [init, address]);
}
