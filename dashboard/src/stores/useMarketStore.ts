import { create } from 'zustand';
import type { DepthPoint, EpochClock, Loan, MemberInfo, MoniaPrint } from '../lib/adapter/types';

interface MarketState {
  clock: EpochClock | null;
  latestMonia: MoniaPrint | null;
  history: MoniaPrint[];
  depth: DepthPoint[];
  members: MemberInfo[];
  loanBook: Loan[];
  setClock: (c: EpochClock) => void;
  setMarket: (m: Partial<Pick<MarketState, 'latestMonia' | 'history' | 'depth' | 'members' | 'loanBook'>>) => void;
}

export const useMarketStore = create<MarketState>((set) => ({
  clock: null,
  latestMonia: null,
  history: [],
  depth: [],
  members: [],
  loanBook: [],
  setClock: (clock) => set({ clock }),
  setMarket: (m) => set(m),
}));
