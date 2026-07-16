import { Coins, Banknote, Landmark, Bot } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SIM_MEMBERS, SIM_ADMIN, SIM_KEEPER } from './adapter/mock/members';
import { controlActors, rolesForActor } from '../services/control';
import { ADAPTER_MODE } from '../config';
import type { Persona } from './adapter/types';

// Single source of "act as" personas, shared by the header PersonaSwitcher and the ⌘K
// command palette. Mock mode = the deterministic DemoEngine personas; live mode = the
// Control API's real actor EOAs (GET /actors).
export interface PersonaOption {
  label: string;
  roles: Persona[];
  address: string;
  icon: LucideIcon;
  desc: string;
}

export function iconForRole(roles: Persona[]): LucideIcon {
  if (roles.includes('admin')) return Landmark;
  if (roles.includes('keeper')) return Bot;
  if (roles.includes('lender')) return Coins;
  return Banknote;
}

const lender = SIM_MEMBERS.find((m) => m.archetype === 'yield-lender')!;
const borrower = SIM_MEMBERS.find((m) => m.archetype === 'desperate-borrower')!;
export const MOCK_PERSONA_OPTIONS: PersonaOption[] = [
  { label: lender.label, roles: ['lender'], address: lender.address, icon: Coins, desc: 'Lender agent' },
  { label: borrower.label, roles: ['borrower'], address: borrower.address, icon: Banknote, desc: 'Borrower agent' },
  { label: 'Administrator', roles: ['admin'], address: SIM_ADMIN.address, icon: Landmark, desc: 'Auditor / benchmark admin' },
  { label: 'Keeper', roles: ['keeper'], address: SIM_KEEPER.address, icon: Bot, desc: 'Epoch / seize bot' },
];

/** Resolve options for the current adapter mode (async only matters in live mode). */
export async function loadPersonaOptions(): Promise<PersonaOption[]> {
  if (ADAPTER_MODE !== 'live') return MOCK_PERSONA_OPTIONS;
  try {
    const actors = await controlActors();
    return actors.map((a) => {
      const roles = rolesForActor(a.role);
      return { label: a.name, roles, address: a.address, icon: iconForRole(roles), desc: a.role };
    });
  } catch {
    return [];
  }
}

/** Where a persona lands after connecting (member desk, or the ops console). */
export function personaLanding(roles: Persona[]): string {
  if (roles.includes('admin')) return '/ops/admin';
  if (roles.includes('keeper')) return '/ops/keeper';
  return '/app';
}
