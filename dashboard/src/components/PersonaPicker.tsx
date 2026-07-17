import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FlaskConical, Loader2, ArrowRight } from 'lucide-react';
import { useSessionStore } from '../stores/useSessionStore';
import { useToast } from '../contexts/ToastContext';
import { ADAPTER_MODE } from '../config';
import { loadPersonaOptions, personaLanding, MOCK_PERSONA_OPTIONS, type PersonaOption } from '../lib/personaOptions';
import type { Address } from '../lib/adapter/types';

// The single "who do you want to play as" chooser — one modal reused by the header, the
// disconnected landing hero, and the RoleGate prompt (opened via the `personapicker:open`
// window event, mirroring the ⌘K palette). Reuses the exact connect logic from the old
// PersonaSwitcher: loadPersonaOptions → connect() → land on the desk/console → toast.
export function PersonaPicker() {
  const [open, setOpen] = useState(false);
  const [personas, setPersonas] = useState<PersonaOption[] | null>(
    ADAPTER_MODE === 'live' ? null : MOCK_PERSONA_OPTIONS,
  );
  const firstRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const connect = useSessionStore((s) => s.connect);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('personapicker:open', onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('personapicker:open', onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement;
    // (Re)load in case live actors changed; mock is already seeded. Guard with a timeout so a
    // HANGING (not erroring) Control API can't leave the spinner up forever — fall back to the
    // honest empty state after 8s.
    let done = false;
    const settle = (o: PersonaOption[]) => { if (!done) { done = true; setPersonas(o); } };
    loadPersonaOptions().then(settle).catch(() => settle([]));
    const timeout = setTimeout(() => settle([]), 8000);
    const t = setTimeout(() => firstRef.current?.focus(), 0);
    return () => { clearTimeout(t); clearTimeout(timeout); };
  }, [open]);

  const close = () => {
    setOpen(false);
    restoreRef.current?.focus?.();
  };

  if (!open) return null;

  const pick = (o: PersonaOption) => {
    connect(o.address as Address, 'persona', o.roles, o.label);
    const isMember = o.roles.includes('lender') || o.roles.includes('borrower');
    navigate(personaLanding(o.roles));
    toast.info(isMember ? `Playing as ${o.label} — next: register your key` : `Playing as ${o.label}`);
    close();
  };

  const members = (personas ?? []).filter((o) => o.roles.includes('lender') || o.roles.includes('borrower'));
  const ops = (personas ?? []).filter((o) => o.roles.includes('admin') || o.roles.includes('keeper'));
  const loading = ADAPTER_MODE === 'live' && personas === null;
  const empty = personas != null && personas.length === 0;

  const Group = ({ title, items }: { title: string; items: PersonaOption[] }) =>
    items.length === 0 ? null : (
      <div className="mb-2 last:mb-0">
        <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-gray-500">{title}</div>
        {items.map((o, i) => {
          const Icon = o.icon;
          return (
            <button
              key={o.address}
              ref={title === 'Members' && i === 0 ? firstRef : undefined}
              onClick={() => pick(o)}
              className="group w-full flex items-center gap-3 px-2.5 py-2.5 rounded-lg hover:bg-white/[0.05] focus-visible:bg-white/[0.05] transition-colors text-left outline-none"
            >
              <div className="w-9 h-9 rounded-lg bg-benchmark-500/10 text-benchmark-400 flex items-center justify-center flex-shrink-0">
                <Icon className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-white capitalize truncate">{o.label}</div>
                <div className="text-[11px] text-gray-500 capitalize truncate">{o.desc}</div>
              </div>
              <ArrowRight className="w-4 h-4 text-gray-700 group-hover:text-benchmark-400 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
            </button>
          );
        })}
      </div>
    );

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center pt-[14vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a persona"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={close} />
      <div className="relative w-full max-w-md glass p-2 animate-fade-in-down max-h-[72vh] flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06]">
          <FlaskConical className="w-4 h-4 text-benchmark-400 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">Choose who to play as</div>
            <div className="text-[11px] text-gray-500">
              {ADAPTER_MODE === 'live' ? 'Simulated actors (server-side keys)' : 'Simulated personas — no wallet, no keys needed'}
            </div>
          </div>
          <span className="ml-auto pill num bg-white/[0.05] text-gray-500 border border-white/[0.08] text-[10px]">esc</span>
        </div>
        <div className="overflow-y-auto py-1.5">
          {loading && (
            <div className="flex items-center gap-2 px-3 py-6 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading actors…
            </div>
          )}
          {empty && (
            <div className="px-3 py-6 text-center text-sm text-gray-500">
              No actors available. In live mode, the Control API must be reachable.
            </div>
          )}
          <Group title="Members" items={members} />
          <Group title="Operators" items={ops} />
        </div>
      </div>
    </div>
  );
}
