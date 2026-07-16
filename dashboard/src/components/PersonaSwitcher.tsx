import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, FlaskConical, Loader2 } from 'lucide-react';
import { useSessionStore } from '../stores/useSessionStore';
import { useToast } from '../contexts/ToastContext';
import { ADAPTER_MODE } from '../config';
import { MOCK_PERSONA_OPTIONS, loadPersonaOptions, personaLanding, type PersonaOption } from '../lib/personaOptions';

// "Act as" a disclosed simulated member. Options come from the shared lib/personaOptions
// (also used by the ⌘K command palette).
export default function PersonaSwitcher() {
  const connect = useSessionStore((s) => s.connect);
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [liveOpts, setLiveOpts] = useState<PersonaOption[] | null>(ADAPTER_MODE === 'live' ? null : MOCK_PERSONA_OPTIONS);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ADAPTER_MODE !== 'live') return;
    let alive = true;
    loadPersonaOptions().then((opts) => alive && setLiveOpts(opts));
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
                  // No dead end: land on the desk / ops console and prompt the next step.
                  const isMember = o.roles.includes('lender') || o.roles.includes('borrower');
                  navigate(personaLanding(o.roles));
                  toast.info(isMember ? `Connected as ${o.label} — next: register your key` : `Connected as ${o.label}`);
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
