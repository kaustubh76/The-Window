// REST client for the off-chain indexer (services/indexer) — forks the sibling app's
// fetchWithRetry + TTL-cache pattern. Used by the LiveAdapter for M-ONIA history, depth,
// and loan lifecycle (events the chain doesn't expose cheaply). No-ops gracefully until
// the indexer is running.
import { INDEXER_URL } from '../config';

interface CacheEntry {
  at: number;
  value: unknown;
}
const cache = new Map<string, CacheEntry>();
const TTL_MS = 4_000;
const MAX_ENTRIES = 200;

export async function fetchWithRetry(path: string, opts: { retries?: number; timeoutMs?: number } = {}): Promise<Response> {
  const { retries = 2, timeoutMs = 8_000 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${INDEXER_URL}${path}`, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('indexer unreachable');
}

export async function getJson<T>(path: string, useCache = true): Promise<T> {
  if (useCache) {
    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  }
  const res = await fetchWithRetry(path);
  if (!res.ok) throw new Error(`indexer ${path} → ${res.status}`);
  const value = (await res.json()) as T;
  if (useCache) {
    if (cache.size >= MAX_ENTRIES) cache.clear();
    cache.set(path, { at: Date.now(), value });
  }
  return value;
}

// Endpoint map the indexer is expected to serve (see services/indexer spec).
export const IndexerAPI = {
  latestMonia: () => getJson('/monia/latest'),
  moniaHistory: (limit = 40) => getJson(`/monia/history?limit=${limit}`),
  depth: (epoch?: number) => getJson(`/depth${epoch != null ? `?epoch=${epoch}` : ''}`),
  loans: () => getJson('/loans'),
  members: () => getJson('/members'),
  epochClock: () => getJson('/epoch/clock', false),
  aggregates: (epoch: number) => getJson(`/aggregates/${epoch}`),
  health: () => getJson('/health', false),
};
