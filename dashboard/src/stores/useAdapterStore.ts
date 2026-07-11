import { create } from 'zustand';
import { getAdapter } from '../lib/adapter';
import type { WindowAdapter } from '../lib/adapter/WindowAdapter';
import { ADAPTER_MODE, type AdapterMode } from '../config';

interface AdapterState {
  adapter: WindowAdapter | null;
  mode: AdapterMode;
  isInitialized: boolean;
  error: string | null;
  init: () => Promise<WindowAdapter | null>;
}

export const useAdapterStore = create<AdapterState>((set, get) => ({
  adapter: null,
  mode: ADAPTER_MODE,
  isInitialized: false,
  error: null,

  init: async () => {
    const existing = get().adapter;
    if (existing) return existing;
    try {
      const adapter = await getAdapter();
      set({ adapter, isInitialized: true, mode: adapter.mode, error: null });
      return adapter;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Adapter init failed';
      set({ error: message, isInitialized: false });
      console.error('[adapter] init failed:', e);
      return null;
    }
  },
}));
