import { create } from 'zustand';
import type { Balances, Loan, MyBid, UsdcMicro } from '../lib/adapter/types';

interface PositionsState {
  balances: Balances | null;
  revealed: UsdcMicro | null; // client-side self-decrypted eERC balance (owner-only)
  myBids: MyBid[];
  myLoans: Loan[];
  set: (p: Partial<Pick<PositionsState, 'balances' | 'myBids' | 'myLoans'>>) => void;
  setRevealed: (v: UsdcMicro | null) => void;
  clear: () => void;
}

export const usePositionsStore = create<PositionsState>((set) => ({
  balances: null,
  revealed: null,
  myBids: [],
  myLoans: [],
  set: (p) => set(p),
  setRevealed: (revealed) => set({ revealed }),
  clear: () => set({ balances: null, revealed: null, myBids: [], myLoans: [] }),
}));
