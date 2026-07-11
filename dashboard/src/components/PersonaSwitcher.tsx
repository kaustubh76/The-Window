import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Coins, Banknote, Landmark, Bot, FlaskConical, Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSessionStore } from '../stores/useSessionStore';
import { SIM_MEMBERS, SIM_ADMIN, SIM_KEEPER } from '../lib/adapter/mock/members';
import { controlActors, rolesForActor } from '../services/control';
import { ADAPTER_MODE } from '../config';
import type { Persona } from '../lib/adapter/types';

interface Option {
  label: string;
  roles: Persona[];
  address: string;
  icon: LucideIcon;
  desc: string;
}

function iconForRole(roles: Persona[]): LucideIcon {
  if (roles.includes('admin')) return Landmark;
  if (roles.includes('keeper')) return Bot;
  if (roles.includes('lender')) return Coins;
  return Banknote;
}

// Mock personas (deterministic simulation)
const lender = SIM_MEMBERS.find((m) => m.archetype === 'yield-lender')!;
const borrower = SIM_MEMBERS.find((m) => m.archetype === 'desperate-borrower')!;
const MOCK_OPTIONS: Option[] = [
  { label: lender.label, roles: ['lender'], address: lender.address, icon: Coins, desc: 'Lender agent' },
  { label: borrower.label, roles: ['borrower'], address: borrower.address, icon: Banknote, desc: 'Borrower agent' },
  { label: 'Administrator', roles: ['admin'], address: SIM_ADMIN.address, icon: Landmark, desc: 'Auditor / benchmark admin' },
  { label: 'Keeper', roles: ['keeper'], address: SIM_KEEPER.address, icon: Bot, desc: 'Epoch / seize bot' },
];

// "Act as" a disclosed simulated member. In mock mode these are the DemoEngine personas; in
// live mode they are the Control API's real actor EOAs (GET /actors) — the connected address
// MUST be one of these for server-side writes to resolve.
export default function PersonaSwitcher() {
  const connect = useSessionStore((s) => s.connect);
  const [open, setOpen] = useState(false);
  const [liveOpts, setLiveOpts] = useState<Option[] | null>(ADAPTER_MODE === 'live' ? null : MOCK_OPTIONS);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ADAPTER_MODE !== 'live') return;
    let alive = true;
    controlActors()
      .then((actors) => {
        if (!alive) return;
        setLiveOpts(
          actors.map((a) => {
            const roles = rolesForActor(a.role);
            return { label: a.name, roles, address: a.address, icon: iconForRole(roles), desc: a.role };
          }),
        );
      })
      .catch(() => alive && setLiveOpts([]));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const options = liveOpts;
  const loading = ADAPTER_MODE === 'live' && liveOpts === null;

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="btn btn-primary flex items-center gap-2">
        <FlaskConical className="w-4 h-4" /> Connect as
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-64 glass p-1.5 z-50 animate-fade-in-down max-h-[70vh] overflow-y-auto">
          <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-gray-500">
            {ADAPTER_MODE === 'live' ? 'Simulated actor (server-side keys)' : 'Simulated persona'}
          </div>
          {loading && (
            <div className="flex items-center gap-2 px-2.5 py-3 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading actors…
            </div>
          )}
          {options && options.length === 0 && (
            <div className="px-2.5 py-3 text-xs text-gray-600">Control API unreachable — is it running on :8899?</div>
          )}
          {options?.map((o) => {
            const Icon = o.icon;
            return (
              <button
                key={o.address}
                onClick={() => {
                  connect(o.address as `0x${string}`, 'persona', o.roles, o.label);
                  setOpen(false);
                }}
                className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-white/[0.05] transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-lg bg-benchmark-500/10 text-benchmark-400 flex items-center justify-center">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm text-white capitalize truncate">{o.label}</div>
                  <div className="text-[11px] text-gray-500 capitalize">{o.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
