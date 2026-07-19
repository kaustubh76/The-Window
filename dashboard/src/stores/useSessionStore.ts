import { create } from 'zustand';
import { useAdapterStore } from './useAdapterStore';
import { ADMIN_ADDR, KEEPER_ADDR } from '../config';
import type { Address, Persona } from '../lib/adapter/types';

export function personaFor(addr: Address): Persona[] {
  const a = addr.toLowerCase();
  if (ADMIN_ADDR && a === ADMIN_ADDR) return ['admin'];
  if (KEEPER_ADDR && a === KEEPER_ADDR) return ['keeper'];
  return ['lender', 'borrower'];
}

interface SessionState {
  address: Address | null;
  source: 'wallet' | 'persona' | null;
  persona: Persona[];
  registered: boolean;
  label?: string;
  connect: (addr: Address, source: 'wallet' | 'persona', persona?: Persona[], label?: string) => void;
  disconnect: () => void;
  setRegistered: (b: boolean) => void;
  refreshRegistration: () => Promise<void>;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  address: null,
  source: null,
  persona: ['public'],
  registered: false,
  label: undefined,

  connect: (address, source, persona, label) => {
    set({ address, source, persona: persona ?? personaFor(address), label, registered: false });
    void get().refreshRegistration();
  },

  disconnect: () => {
    set({ address: null, source: null, persona: ['public'], registered: false, label: undefined });
  },

  setRegistered: (registered) => set({ registered }),

  refreshRegistration: async () => {
    const addr = get().address;
    const adapter = useAdapterStore.getState().adapter;
    if (!addr || !adapter) return;
    try {
      const bal = await adapter.getBalances(addr);
      set({ registered: bal.registered });
    } catch {
      /* ignore */
    }
  },
}));

export function is(persona: Persona[], role: Persona) {
  return persona.includes(role);
}
