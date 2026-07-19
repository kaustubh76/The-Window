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

export interface OnboardResult {
  address: Address;
  label: string;
  roles: Persona[];
  allowlisted: boolean | null; // L1 TxAllowList enabled (null off the L1)
}

/**
 * Onboard a brand-new, dynamic member: Control mints a fresh on-chain identity (real EOA +
 * eERC key), funds its gas, admits it to MemberRegistry, and seeds a starter balance — so the
 * user is a REAL participant, not one of the baked personas. Returns the new member's address.
 */
export async function controlOnboard(label?: string): Promise<OnboardResult> {
  const j = await req('/member/onboard', { label });
  return {
    address: String(j.address).toLowerCase() as Address,
    label: String(j.label ?? ''),
    roles: Array.isArray(j.roles) && j.roles.length ? (j.roles as Persona[]) : ['lender', 'borrower'],
    allowlisted: j.allowlisted ?? null,
  };
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

export interface RevokeStep {
  key: string;
  label: string;
  ok: boolean;
}
export interface RevokeDemoResult {
  ok: boolean;
  subject?: { name: string; address: string };
  steps?: RevokeStep[];
  restored?: boolean;
  error?: string;
}

/** Run the live atomic revocation on the L1 (removeMember → 4 layers ✗ → restore). */
export async function runRevokeDemo(address?: string): Promise<RevokeDemoResult> {
  try {
    return (await req('/l1/revoke-demo', { address }, 'POST')) as RevokeDemoResult;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'revoke-demo failed' };
  }
}

export interface L1Info {
  ok: boolean;
  chainId?: number;
  block?: number;
  networkID?: number | null;
  anchor?: 'fuji' | 'mainnet' | 'local';
  nodeID?: string | null;
  blockchainId?: string | null;
}

/** Live chain identity — proves Fuji-anchoring (networkID 5) vs a local network. */
export async function l1Info(): Promise<L1Info> {
  try {
    return (await req('/l1/info', undefined, 'GET')) as L1Info;
  } catch {
    return { ok: false };
  }
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
    case 'member': // dynamically-onboarded real user — can both lend and borrow
      return ['lender', 'borrower'];
    default:
      return ['public'];
  }
}
