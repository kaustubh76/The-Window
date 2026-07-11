import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Coins, Banknote, Landmark, Bot, FlaskConical } from 'lucide-react';
import { useSessionStore } from '../stores/useSessionStore';
import { SIM_MEMBERS, SIM_ADMIN, SIM_KEEPER } from '../lib/adapter/mock/members';
import type { Persona } from '../lib/adapter/types';

const lender = SIM_MEMBERS.find((m) => m.archetype === 'yield-lender')!;
const borrower = SIM_MEMBERS.find((m) => m.archetype === 'desperate-borrower')!;

const OPTIONS: { label: string; roles: Persona[]; address: string; icon: typeof Coins; desc: string }[] = [
  { label: lender.label, roles: ['lender'], address: lender.address, icon: Coins, desc: 'Lender agent' },
  { label: borrower.label, roles: ['borrower'], address: borrower.address, icon: Banknote, desc: 'Borrower agent' },
  { label: 'Administrator', roles: ['admin'], address: SIM_ADMIN.address, icon: Landmark, desc: 'Auditor / benchmark admin' },
  { label: 'Keeper', roles: ['keeper'], address: SIM_KEEPER.address, icon: Bot, desc: 'Epoch / seize bot' },
];

// Mock-only: lets a judge step into any persona without juggling keys.
export default function PersonaSwitcher() {
  const connect = useSessionStore((s) => s.connect);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="btn btn-primary flex items-center gap-2">
        <FlaskConical className="w-4 h-4" /> Connect as
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-64 glass p-1.5 z-50 animate-fade-in-down">
          <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-gray-500">Simulated persona</div>
          {OPTIONS.map((o) => {
            const Icon = o.icon;
            return (
              <button
                key={o.label}
                onClick={() => {
                  connect(o.address as `0x${string}`, 'persona', o.roles, o.label);
                  setOpen(false);
                }}
                className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-white/[0.05] transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-lg bg-benchmark-500/10 text-benchmark-400 flex items-center justify-center">
                  <Icon className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm text-white">{o.label}</div>
                  <div className="text-[11px] text-gray-500">{o.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
