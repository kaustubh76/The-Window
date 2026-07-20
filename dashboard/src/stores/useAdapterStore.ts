import { create } from 'zustand';
import { getAdapter } from '../lib/adapter';
import type { WindowAdapter } from '../lib/adapter/WindowAdapter';

interface AdapterState {
  adapter: WindowAdapter | null;
  isInitialized: boolean;
  error: string | null;
  init: () => Promise<WindowAdapter | null>;
}

export const useAdapterStore = create<AdapterState>((set, get) => ({
  adapter: null,
  isInitialized: false,
  error: null,

  init: async () => {
    const existing = get().adapter;
    if (existing) return existing;
    try {
      const adapter = await getAdapter();
      set({ adapter, isInitialized: true, error: null });
      return adapter;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Adapter init failed';
      set({ error: message, isInitialized: false });
      console.error('[adapter] init failed:', e);
      return null;
    }
  },
}));
