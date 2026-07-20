import { useEffect, useRef } from 'react';
import { READ_GATED } from '../config';
import { controlActors, rolesForActor } from '../services/control';
import { useSessionStore } from '../stores/useSessionStore';

// On the permissioned L1, indexer reads are member-gated — so with no session actor the
// market renders empty. Default-select the first member persona on load ("a member viewing
// the consortium") so Market/Explorer render immediately. One-shot and guarded: never
// overrides a real wallet/persona connection, and no-ops on Fuji (READ_GATED off). The /l1
// page's Outsider toggle is independent (its own local probe), so the gate is still shown.
export function useL1AutoConnect() {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !READ_GATED) return;
    if (useSessionStore.getState().address) return; // already connected (wallet/persona)
    done.current = true;
    controlActors()
      .then((actors) => {
        if (useSessionStore.getState().address) return; // race: user connected meanwhile
        const m = actors.find((a) => a.role === 'lender' || a.role === 'borrower');
        if (m) useSessionStore.getState().connect(m.address, 'persona', rolesForActor(m.role), m.name);
      })
      .catch(() => {
        /* Control unreachable — stay disconnected (reads gate to empty) */
      });
  }, []);
}
