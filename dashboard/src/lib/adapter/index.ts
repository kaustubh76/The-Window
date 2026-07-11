import { ADAPTER_MODE } from '../../config';
import type { WindowAdapter } from './WindowAdapter';

// Single entry point. Lazy-imports the selected adapter and memoizes it with a
// promise-guard (so concurrent init() calls never double-construct / double-load WASM).
let instance: WindowAdapter | null = null;
let initPromise: Promise<WindowAdapter> | null = null;

async function build(): Promise<WindowAdapter> {
  if (ADAPTER_MODE === 'live') {
    const { LiveAdapter } = await import('./live/LiveAdapter');
    const a = new LiveAdapter();
    await a.init();
    return a;
  }
  const { MockAdapter } = await import('./mock/MockAdapter');
  const a = new MockAdapter();
  await a.init();
  return a;
}

export async function getAdapter(): Promise<WindowAdapter> {
  if (instance) return instance;
  if (!initPromise) {
    initPromise = build()
      .then((a) => {
        instance = a;
        return a;
      })
      .finally(() => {
        initPromise = null;
      });
  }
  return initPromise;
}

/** Test-only reset. */
export function __resetAdapter() {
  instance = null;
  initPromise = null;
}
