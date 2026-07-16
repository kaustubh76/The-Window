// Read-gate auth for the permissioned L1. The dashboard is keyless (persona / Control
// model), so it cannot sign the indexer's read challenge itself. For a MEMBER, the
// Control API mints a member-signed token (POST /member/read-token); a non-member gets a
// 403 and no token — so their indexer reads 403 too (the read-gate, rendered live).
//
// Contract MUST match services/indexer/index.mjs READ_GATE middleware and services/
// control/index.mjs /member/read-token: challenge = `window-read:<floor(now/30s)>`,
// headers x-window-address + x-window-sig, verifier accepts current + previous bucket.
import { READ_GATED, CONTROL_URL } from '../config';

interface Token {
  address: string;
  sig: string;
  bucket: number;
}

let actor: string | null = null;
let token: Token | null = null;
let negativeUntil = 0; // known non-member — back off refetching for a bit
let inflight: Promise<Token | null> | null = null;

const bucketNow = () => Math.floor(Date.now() / 30_000);

/** Reflect the current session member address (called from useEercBridge). */
export function setReadActor(a: string | null): void {
  const next = a ? a.toLowerCase() : null;
  if (next === actor) return;
  actor = next;
  token = null;
  negativeUntil = 0;
  inflight = null;
}

/** Drop the cached token (e.g. the /l1 "Outsider" toggle). */
export function clearReadToken(): void {
  token = null;
  negativeUntil = 0;
  inflight = null;
}

export function isReadGated(): boolean {
  return READ_GATED;
}

async function fetchToken(): Promise<Token | null> {
  if (!actor) return null;
  try {
    const res = await fetch(`${CONTROL_URL}/member/read-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: actor }),
    });
    if (res.status === 403) {
      negativeUntil = Date.now() + 15_000; // not a member; stop hammering Control
      return null;
    }
    if (!res.ok) return null;
    const j = (await res.json()) as { ok?: boolean; address?: string; sig?: string; bucket?: number };
    if (!j?.ok || !j.sig || j.bucket == null) return null;
    return { address: String(j.address).toLowerCase(), sig: j.sig, bucket: Number(j.bucket) };
  } catch {
    return null; // Control unreachable — read stays gated (empty), never throws
  }
}

/**
 * Headers to attach to every gated indexer read. Empty object when not gated, no actor,
 * or the actor is a known non-member — in which case the indexer returns 403 and the UI
 * shows the gated state.
 */
export async function getReadHeaders(): Promise<Record<string, string>> {
  if (!READ_GATED || !actor) return {};
  if (Date.now() < negativeUntil) return {};
  const b = bucketNow();
  if (token && token.address === actor && (token.bucket === b || token.bucket === b - 1)) {
    return { 'x-window-address': token.address, 'x-window-sig': token.sig };
  }
  if (!inflight) inflight = fetchToken().finally(() => { inflight = null; });
  token = await inflight;
  return token ? { 'x-window-address': token.address, 'x-window-sig': token.sig } : {};
}
