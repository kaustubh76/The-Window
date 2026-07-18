// REST client for the off-chain indexer (services/indexer) — forks the sibling app's
// fetchWithRetry + TTL-cache pattern. Used by the LiveAdapter for M-ONIA history, depth,
// and loan lifecycle (events the chain doesn't expose cheaply). No-ops gracefully until
// the indexer is running.
import { INDEXER_URL, READ_GATED } from '../config';
import { getReadHeaders } from './readAuth';

interface CacheEntry {
  at: number;
  value: unknown;
}
const cache = new Map<string, CacheEntry>();
const TTL_MS = 4_000;
const MAX_ENTRIES = 200;

export async function fetchWithRetry(path: string, opts: { retries?: number; timeoutMs?: number } = {}): Promise<Response> {
  const { retries = 2, timeoutMs = 8_000 } = opts;
  // On the read-gated L1, attach the member-signature headers (empty on Fuji / for a
  // non-member — the indexer then 403s and the UI shows the gated state).
  const headers = await getReadHeaders();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${INDEXER_URL}${path}`, { signal: ctrl.signal, headers });
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

// Coalesce concurrent identical GETs: several hooks/pollers can tick at once under
// latency, and each used to open its own socket for the same path. One request per
// path in flight; everyone shares the response. Never on the read-gated L1 — those
// requests carry per-actor headers a coalesced response must not leak across.
const inflight = new Map<string, Promise<unknown>>();

export async function getJson<T>(path: string, useCache = true, opts: { retries?: number; timeoutMs?: number } = {}): Promise<T> {
  // Never cache gated reads: the response depends on the current actor's token, so a
  // cached member response must not leak across an actor/outsider switch.
  const cacheable = useCache && !READ_GATED;
  if (cacheable) {
    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  }
  if (!READ_GATED) {
    const pending = inflight.get(path);
    if (pending) return pending as Promise<T>;
  }
  const p = (async () => {
    const res = await fetchWithRetry(path, opts);
    if (!res.ok) throw new Error(`indexer ${path} → ${res.status}`);
    const value = (await res.json()) as T;
    if (cacheable) {
      if (cache.size >= MAX_ENTRIES) cache.clear();
      cache.set(path, { at: Date.now(), value });
    }
    return value;
  })();
  if (!READ_GATED) {
    inflight.set(path, p);
    const done = () => inflight.delete(path);
    p.then(done, done);
  }
  return p;
}

// Endpoint map the indexer is expected to serve (see services/indexer spec).
export const IndexerAPI = {
  latestMonia: () => getJson('/monia/latest'),
  moniaHistory: (limit = 40) => getJson(`/monia/history?limit=${limit}`),
  depth: (epoch?: number) => getJson(`/depth${epoch != null ? `?epoch=${epoch}` : ''}`),
  loans: () => getJson('/loans'),
  members: () => getJson('/members'),
  // no retries: a failed clock poll is superseded by the next 1s tick anyway — retrying
  // only holds sockets open exactly when the backend is already struggling
  epochClock: () => getJson('/epoch/clock', false, { retries: 0, timeoutMs: 5_000 }),
  aggregates: (epoch: number) => getJson(`/aggregates/${epoch}`),
  events: (since = 0) => getJson(`/events?since=${since}`, false),
  bids: (address: string) => getJson(`/bids?address=${address}`, false),
  health: () => getJson('/health', false),
};
