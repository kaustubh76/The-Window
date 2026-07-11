import type { Address, Persona } from '../types';

// Deterministic fake EOA from a label (mock only). Never used on-chain.
export function fakeAddress(label: string): Address {
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let hex = '';
  let x = h >>> 0;
  for (let i = 0; i < 40; i++) {
    x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0;
    hex += (x & 0xf).toString(16);
  }
  return (`0x${hex}`) as Address;
}

export type Archetype = 'yield-lender' | 'opportunistic-lender' | 'desperate-borrower' | 'opportunistic-borrower' | 'noise';

export interface SimMember {
  address: Address;
  label: string;
  archetype: Archetype;
  roles: Persona[];
}

// Fixed roster of SIMULATED members (mandatory self-dealing disclosure — all demo bidders are ours).
export const SIM_MEMBERS: SimMember[] = [
  { label: 'Aurora Treasury', archetype: 'yield-lender', roles: ['lender'], address: fakeAddress('Aurora Treasury') },
  { label: 'Helios Fund', archetype: 'opportunistic-lender', roles: ['lender'], address: fakeAddress('Helios Fund') },
  { label: 'Mission Control', archetype: 'desperate-borrower', roles: ['borrower'], address: fakeAddress('Mission Control') },
  { label: 'Orbital Labs', archetype: 'opportunistic-borrower', roles: ['borrower'], address: fakeAddress('Orbital Labs') },
  { label: 'Nyx Trading', archetype: 'noise', roles: ['borrower', 'lender'], address: fakeAddress('Nyx Trading') },
];

// Ops personas (also simulated in mock mode).
export const SIM_ADMIN: SimMember = {
  label: 'Benchmark Administrator',
  archetype: 'noise',
  roles: ['admin'],
  address: fakeAddress('Benchmark Administrator'),
};
export const SIM_KEEPER: SimMember = {
  label: 'Keeper',
  archetype: 'noise',
  roles: ['keeper'],
  address: fakeAddress('Keeper'),
};

export function memberLabel(addr: Address): string | undefined {
  const all = [...SIM_MEMBERS, SIM_ADMIN, SIM_KEEPER];
  return all.find((m) => m.address.toLowerCase() === addr.toLowerCase())?.label;
}
