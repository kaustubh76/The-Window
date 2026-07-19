import { LiveAdapter } from './live/LiveAdapter';
import type { WindowAdapter } from './WindowAdapter';

// Single entry point. Constructs the LiveAdapter and memoizes it with a promise-guard
// (so concurrent init() calls never double-construct).
let instance: WindowAdapter | null = null;
let initPromise: Promise<WindowAdapter> | null = null;

async function build(): Promise<WindowAdapter> {
  const a = new LiveAdapter();
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
