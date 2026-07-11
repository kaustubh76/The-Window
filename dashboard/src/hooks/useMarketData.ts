import { useEffect } from 'react';
import { useAdapterStore } from '../stores/useAdapterStore';
import { useMarketStore } from '../stores/useMarketStore';
import { MARKET_POLL_MS } from '../constants/ui';
import type { WindowAdapter } from '../lib/adapter/WindowAdapter';
import type { WindowEvent } from '../lib/adapter/types';

const REFRESH_ON: WindowEvent['type'][] = [
  'RatePrinted',
  'EpochClosed',
  'MatchesPosted',
  'LoanFunded',
  'LoanRepaid',
  'LoanSeized',
];

// Wires the adapter into useMarketStore: frequent clock ticks + event/poll-driven
// market refresh. Call once on any public market surface.
export function useMarketData() {
  const init = useAdapterStore((s) => s.init);

  useEffect(() => {
    let alive = true;
    let unsubClock = () => {};
    let unsubEv = () => {};
    let poll: ReturnType<typeof setInterval> | null = null;

    const refresh = async (a: WindowAdapter) => {
      const [latestMonia, history, depth, members, loanBook] = await Promise.all([
        a.getLatestMonia(),
        a.getMoniaHistory(40),
        a.getDepthCurve(),
        a.getMembers(),
        a.getLoanBook(),
      ]);
      if (alive) useMarketStore.getState().setMarket({ latestMonia, history, depth, members, loanBook });
    };

    init().then((a) => {
      if (!a || !alive) return;
      unsubClock = a.subscribeClock((c) => useMarketStore.getState().setClock(c));
      unsubEv = a.subscribe((e) => {
        if (REFRESH_ON.includes(e.type)) void refresh(a);
      });
      void refresh(a);
      poll = setInterval(() => void refresh(a), MARKET_POLL_MS);
    });

    return () => {
      alive = false;
      unsubClock();
      unsubEv();
      if (poll) clearInterval(poll);
    };
  }, [init]);
}
