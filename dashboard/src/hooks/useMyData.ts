import { useEffect } from 'react';
import { useAdapterStore } from '../stores/useAdapterStore';
import { useSessionStore } from '../stores/useSessionStore';
import { usePositionsStore } from '../stores/usePositionsStore';
import { MARKET_POLL_MS } from '../constants/ui';
import type { WindowAdapter } from '../lib/adapter/WindowAdapter';

// Hydrates the connected address's balances, bids, and loans. Refreshes on clock ticks
// (so loan lifecycle transitions appear) and on a poll.
export function useMyData() {
  const init = useAdapterStore((s) => s.init);
  const address = useSessionStore((s) => s.address);

  useEffect(() => {
    if (!address) {
      usePositionsStore.getState().clear();
      return;
    }
    let alive = true;
    let unsubClock = () => {};
    let poll: ReturnType<typeof setInterval> | null = null;

    const refresh = async (a: WindowAdapter) => {
      const [balances, myBids, myLoans] = await Promise.all([a.getBalances(address), a.getMyBids(address), a.getMyLoans(address)]);
      if (alive) usePositionsStore.getState().set({ balances, myBids, myLoans });
    };

    init().then((a) => {
      if (!a || !alive) return;
      // refresh loans on clock ticks (throttled by React state equality is not free, so poll instead)
      unsubClock = a.subscribeClock(() => {});
      void refresh(a);
      poll = setInterval(() => void refresh(a), MARKET_POLL_MS);
    });

    return () => {
      alive = false;
      unsubClock();
      if (poll) clearInterval(poll);
    };
  }, [init, address]);
}
