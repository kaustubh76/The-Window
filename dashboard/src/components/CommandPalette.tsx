import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  Search, LineChart, Binary, Network, LayoutDashboard, BookText, Activity, Landmark, Bot,
  Wallet, Gavel, Droplet, KeyRound, Eye, LogOut, CornerDownLeft,
} from 'lucide-react';
import { useSessionStore } from '../stores/useSessionStore';
import { usePositionsStore } from '../stores/usePositionsStore';
import { useAdapterStore } from '../stores/useAdapterStore';
import { useToast } from '../contexts/ToastContext';
import { loadPersonaOptions, personaLanding, type PersonaOption } from '../lib/personaOptions';
import type { Address } from '../lib/adapter/types';

interface Cmd {
  id: string;
  label: string;
  group: string;
  icon: LucideIcon;
  hint?: string;
  run: () => void;
}

// ⌘K command palette — quick nav + actions. Reuses the shared persona options, the session/
// adapter stores, and the toast next-action support. Field is clear (no other ⌘K/modal).
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [personas, setPersonas] = useState<PersonaOption[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const navigate = useNavigate();
  const toast = useToast();
  const { address, persona, registered } = useSessionStore();

  // ⌘K / Ctrl+K to open (the demo shortcut hook rejects modifiers, so this can't conflict).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    const onOpen = () => setOpen(true); // header hint / other triggers
    window.addEventListener('keydown', onKey);
    window.addEventListener('commandpalette:open', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('commandpalette:open', onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    loadPersonaOptions().then(setPersonas).catch(() => setPersonas([]));
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const close = () => setOpen(false);
  const go = (to: string) => { navigate(to); close(); };

  const commands: Cmd[] = useMemo(() => {
    const adapter = () => useAdapterStore.getState().adapter;
    const addr = address as Address | null;
    const nav: Cmd[] = [
      { id: 'n-market', label: 'Market', group: 'Go to', icon: LineChart, run: () => go('/') },
      { id: 'n-explorer', label: 'Explorer', group: 'Go to', icon: Binary, run: () => go('/explorer') },
      { id: 'n-desk', label: 'Your Desk (Trade)', group: 'Go to', icon: LayoutDashboard, run: () => go('/app') },
      { id: 'n-wallet', label: 'Wallet', group: 'Go to', icon: Wallet, run: () => go('/app/wallet') },
      { id: 'n-auction', label: 'Auction', group: 'Go to', icon: Gavel, run: () => go('/app/auction') },
      { id: 'n-positions', label: 'Positions', group: 'Go to', icon: Landmark, run: () => go('/app/positions') },
      { id: 'n-method', label: 'Methodology', group: 'Go to', icon: BookText, run: () => go('/methodology') },
      { id: 'n-diag', label: 'Diagnostics', group: 'Go to', icon: Activity, run: () => go('/diagnostics') },
      { id: 'n-l1', label: 'Permissioned L1', group: 'Go to', icon: Network, run: () => go('/l1') },
      ...(persona.includes('admin') ? [{ id: 'n-admin', label: 'Administrator console', group: 'Go to', icon: Landmark, run: () => go('/ops/admin') } as Cmd] : []),
      ...(persona.includes('keeper') ? [{ id: 'n-keeper', label: 'Keeper console', group: 'Go to', icon: Bot, run: () => go('/ops/keeper') } as Cmd] : []),
    ];
    const connectCmds: Cmd[] = personas.map((p) => ({
      id: `c-${p.address}`,
      label: `Connect as ${p.label}`,
      group: 'Act as',
      icon: p.icon,
      hint: p.desc,
      run: () => {
        useSessionStore.getState().connect(p.address as Address, 'persona', p.roles, p.label);
        navigate(personaLanding(p.roles));
        toast.info(`Connected as ${p.label}`);
        close();
      },
    }));
    const actions: Cmd[] = [];
    if (addr) {
      actions.push({
        id: 'a-faucet', label: 'Faucet +1,000 TestUSDC', group: 'Actions', icon: Droplet,
        run: async () => { close(); const r = await adapter()?.faucet(addr, 1000_000000n); toast.success('+1,000 TestUSDC', r?.txHash); },
      });
      if (!registered) actions.push({
        id: 'a-register', label: 'Register encryption key', group: 'Actions', icon: KeyRound,
        run: async () => { close(); const r = await adapter()?.register(addr); if (r?.ok) { useSessionStore.getState().setRegistered(true); toast.success('Registered — encryption key ready', r.txHash); } },
      });
      actions.push({
        id: 'a-reveal', label: 'Reveal my balance', group: 'Actions', icon: Eye,
        run: async () => { close(); const v = await adapter()?.decryptOwnBalance(addr); if (v != null) { usePositionsStore.getState().setRevealed(v); toast.info('Balance revealed (only to you)'); } },
      });
      actions.push({
        id: 'a-disconnect', label: 'Disconnect', group: 'Actions', icon: LogOut,
        run: () => { useSessionStore.getState().disconnect(); toast.info('Disconnected'); close(); },
      });
    }
    return [...nav, ...connectCmds, ...actions];
  }, [personas, persona, address, registered]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? commands.filter((c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)) : commands;
  }, [commands, query]);

  useEffect(() => { setActive(0); }, [query]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(filtered.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); filtered[active]?.run(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  // group in render order while keeping the flat filtered index for keyboard nav
  let flatIdx = -1;
  const groups = ['Go to', 'Act as', 'Actions'].map((g) => ({ g, items: filtered.filter((c) => c.group === g) })).filter((x) => x.items.length);

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[12vh] px-4" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={close} />
      <div className="relative w-full max-w-lg glass p-2 animate-fade-in-down max-h-[70vh] flex flex-col" onKeyDown={onKeyDown}>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
          <Search className="w-4 h-4 text-gray-500 flex-shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent outline-none text-sm text-white placeholder-gray-600"
            placeholder="Search commands — navigate, connect, faucet, reveal…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            role="combobox"
            aria-expanded
            aria-controls="cmdk-list"
          />
          <span className="pill num bg-white/[0.05] text-gray-500 border border-white/[0.08] text-[10px]">esc</span>
        </div>
        <div id="cmdk-list" role="listbox" className="overflow-y-auto py-1.5">
          {filtered.length === 0 && <div className="px-3 py-6 text-center text-sm text-gray-600">No matching command</div>}
          {groups.map(({ g, items }) => (
            <div key={g}>
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-500">{g}</div>
              {items.map((c) => {
                flatIdx++;
                const idx = flatIdx;
                const Icon = c.icon;
                const isActive = idx === active;
                return (
                  <button
                    key={c.id}
                    role="option"
                    aria-selected={isActive}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => c.run()}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${isActive ? 'bg-benchmark-500/15 text-benchmark-300' : 'hover:bg-white/[0.05] text-gray-300'}`}
                  >
                    <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-benchmark-400' : 'text-gray-500'}`} />
                    <span className="flex-1 text-sm truncate">{c.label}</span>
                    {c.hint && <span className="text-[11px] text-gray-600 capitalize truncate">{c.hint}</span>}
                    {isActive && <CornerDownLeft className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// header hint label (⌘K on mac, Ctrl K elsewhere)
export const paletteHint = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent) ? '⌘K' : 'Ctrl K';
