import { useEffect, useState } from 'react';
import { useAdapterStore } from '../stores/useAdapterStore';
import type { EpochClock } from '../lib/adapter/types';

// Subscribes to the adapter's virtual clock. All countdowns derive from clock.now —
// never Date.now() — so DEMO scrubbing and PROD block-time both work.
export function useClock(): EpochClock | null {
  const init = useAdapterStore((s) => s.init);
  const [clock, setClock] = useState<EpochClock | null>(null);

  useEffect(() => {
    let unsub = () => {};
    let alive = true;
    init().then((a) => {
      if (a && alive) unsub = a.subscribeClock(setClock);
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [init]);

  return clock;
}
