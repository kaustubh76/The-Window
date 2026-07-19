import { Coins, Banknote, Landmark, Bot } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { controlActors, rolesForActor } from '../services/control';
import type { Persona } from './adapter/types';

// Single source of "act as" personas, shared by the header PersonaSwitcher and the ⌘K
// command palette: the Control API's real actor EOAs (GET /actors).
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

/** Resolve the persona options from the Control API's actor roster. */
export async function loadPersonaOptions(): Promise<PersonaOption[]> {
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
