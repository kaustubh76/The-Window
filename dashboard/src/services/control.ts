// Client for the Control API (services/control) — the backend that performs member/admin/
// keeper WRITES server-side using the proven eerc-node flows. The browser holds no keys;
// the connected address must resolve to one of the disclosed simulated actors (GET /actors).
import { CONTROL_URL } from '../config';
import type { Address, Persona } from '../lib/adapter/types';

export interface ControlActor {
  name: string;
  address: Address;
  role: string; // 'admin' | 'keeper' | 'operator' | 'lender' | 'borrower'
}

async function req(path: string, body?: unknown, method: 'GET' | 'POST' = 'POST'): Promise<any> {
  const res = await fetch(`${CONTROL_URL}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({ ok: false, error: `control ${res.status}` }));
  if (json && json.ok === false) throw new Error(json.error || `control ${path} failed`);
  return json;
}

/** The authoritative list of actors the Control API can act as. */
export async function controlActors(): Promise<ControlActor[]> {
  const list = (await req('/actors', undefined, 'GET')) as ControlActor[];
  return Array.isArray(list) ? list.map((a) => ({ ...a, address: a.address.toLowerCase() as Address })) : [];
}

// ---- permissioned-L1 surface ----
export interface AllowlistRow {
  address: Address;
  label: string;
  role: number; // 0 None · 1 Enabled · 2 Admin (TxAllowList precompile)
  roleName: string;
  isMember: boolean;
}

/** Live TxAllowList roles for the member set + intruder (Control reads the precompile). */
export async function l1Allowlist(): Promise<{ precompile: string; rows: AllowlistRow[] }> {
  const j = await req('/l1/allowlist', undefined, 'GET');
  const rows: AllowlistRow[] = Array.isArray(j.rows)
    ? j.rows.map((r: AllowlistRow) => ({ ...r, address: String(r.address).toLowerCase() as Address }))
    : [];
  return { precompile: String(j.precompile ?? ''), rows };
}

/** Mint a member-signed read token (null when the address is not a member → 403). */
export async function mintReadToken(address: string): Promise<{ address: string; sig: string } | null> {
  try {
    const res = await fetch(`${CONTROL_URL}/member/read-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.ok && j.sig ? { address: String(j.address), sig: String(j.sig) } : null;
  } catch {
    return null;
  }
}

export async function controlHealth(): Promise<boolean> {
  try {
    const j = await req('/health', undefined, 'GET');
    return !!j.ok;
  } catch {
    return false;
  }
}

/** Map a Control actor role → the dashboard's Persona set (drives RoleGate + ops nav). */
export function rolesForActor(role: string): Persona[] {
  switch (role) {
    case 'admin':
      return ['admin'];
    case 'keeper':
    case 'operator':
      return ['keeper'];
    case 'lender':
      return ['lender'];
    case 'borrower':
      return ['borrower'];
    default:
      return ['public'];
  }
}
