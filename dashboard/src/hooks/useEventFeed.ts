import { useEffect, useRef, useState } from 'react';
import { useAdapterStore } from '../stores/useAdapterStore';
import type { WindowEvent } from '../lib/adapter/types';

// Scrub-safe event feed: resyncs from adapter.recentEvents() on each clock tick, so it
// reflects live play AND backward scrubbing (which rebuilds the world log deterministically).
export function useEventFeed(): WindowEvent[] {
  const init = useAdapterStore((s) => s.init);
  const [feed, setFeed] = useState<WindowEvent[]>([]);
  const lastRef = useRef<WindowEvent | undefined>(undefined);
  const lastLen = useRef(-1);

  useEffect(() => {
    let alive = true;
    let unsub = () => {};
    init().then((a) => {
      if (!a || !alive) return;
      const sync = () => {
        const ev = a.recentEvents();
        const last = ev[ev.length - 1];
        if (ev.length !== lastLen.current || last !== lastRef.current) {
          lastLen.current = ev.length;
          lastRef.current = last;
          setFeed(ev);
        }
      };
      unsub = a.subscribeClock(sync);
      sync();
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [init]);

  return feed;
}
