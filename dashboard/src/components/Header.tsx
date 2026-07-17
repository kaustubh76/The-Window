import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AppWindow, LineChart, Binary, LayoutDashboard, BookText, Activity, Menu, X, Landmark, Bot, Network, Command } from 'lucide-react';
import { paletteHint } from './CommandPalette';
import clsx from 'clsx';
import ConnectWallet from './ConnectWallet';
import ProfileSwitch from './ProfileSwitch';
import HeaderTicker from './HeaderTicker';
import { useSessionStore } from '../stores/useSessionStore';
import { IS_L1 } from '../config';

const baseNav = [
  { path: '/', label: 'Market', icon: LineChart },
  { path: '/explorer', label: 'Explorer', icon: Binary },
  // The L1 story panel only exists on the permissioned L1 deployment (VITE_CHAIN_ID=43117);
  // hidden on Fuji/local so the hosted app never shows a dead tab.
  ...(IS_L1 ? [{ path: '/l1', label: 'L1', icon: Network }] : []),
  { path: '/app', label: 'Trade', icon: LayoutDashboard },
  { path: '/methodology', label: 'Methodology', icon: BookText },
  { path: '/diagnostics', label: 'Diagnostics', icon: Activity },
];

function isActivePath(current: string, path: string) {
  if (path === '/') return current === '/';
  return current === path || current.startsWith(path + '/');
}

export default function Header() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const persona = useSessionStore((s) => s.persona);

  const navItems = [
    ...baseNav,
    ...(persona.includes('admin') ? [{ path: '/ops/admin', label: 'Admin', icon: Landmark }] : []),
    ...(persona.includes('keeper') ? [{ path: '/ops/keeper', label: 'Keeper', icon: Bot }] : []),
  ];

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={clsx(
        'sticky top-0 z-50 transition-all duration-500',
        scrolled
          ? 'bg-surface-0/80 backdrop-blur-2xl border-b border-white/[0.06] shadow-lg shadow-black/20'
          : 'bg-transparent border-b border-transparent',
      )}
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-[72px]">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-3 group">
            <div className="relative">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-benchmark-400 to-benchmark-600 flex items-center justify-center shadow-glow-sm group-hover:shadow-glow transition-shadow duration-500">
                <AppWindow className="w-5 h-5 text-surface-0" />
              </div>
            </div>
            <div className="leading-none">
              <span className="text-lg font-bold text-white tracking-tight">
                THE <span className="text-benchmark-400">WINDOW</span>
              </span>
              <div className="text-[10px] text-gray-500 uppercase tracking-[0.2em] mt-0.5 num">M-ONIA</div>
            </div>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center">
            <div className="flex items-center gap-1 bg-white/[0.03] rounded-xl p-1 border border-white/[0.04]">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = isActivePath(location.pathname, item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={clsx(
                      'relative flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-300',
                      active
                        ? 'bg-benchmark-500/15 text-benchmark-300 shadow-inner-glow'
                        : 'text-gray-400 hover:text-white hover:bg-white/[0.04]',
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                    {active && (
                      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-benchmark-500 rounded-full" />
                    )}
                  </Link>
                );
              })}
            </div>
          </nav>

          {/* Right cluster */}
          <div className="hidden md:flex items-center gap-3">
            <button
              onClick={() => window.dispatchEvent(new Event('commandpalette:open'))}
              className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs num text-gray-500 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.05] transition-colors"
              aria-label="Open command palette"
              title="Command palette"
            >
              <Command className="w-3.5 h-3.5" /> {paletteHint}
            </button>
            <HeaderTicker />
            <ProfileSwitch />
            <ConnectWallet />
          </div>

          {/* Mobile: compact live rate + toggle */}
          <div className="md:hidden ml-auto mr-2">
            <HeaderTicker compact />
          </div>
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className={clsx(
              'md:hidden p-2.5 rounded-xl transition-all duration-300',
              mobileOpen ? 'bg-surface-3 text-white' : 'text-gray-400 hover:text-white hover:bg-white/[0.04]',
            )}
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile panel */}
      {mobileOpen && (
        <nav className="md:hidden border-t border-white/[0.04] bg-surface-0/95 backdrop-blur-2xl animate-fade-in-down">
          <div className="container mx-auto px-4 py-4 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActivePath(location.pathname, item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={clsx(
                    'flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-300',
                    active
                      ? 'bg-benchmark-500/15 text-benchmark-300 border border-benchmark-500/20'
                      : 'text-gray-400 hover:text-white hover:bg-white/[0.04]',
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                </Link>
              );
            })}
            <button
              onClick={() => {
                window.dispatchEvent(new Event('commandpalette:open'));
                setMobileOpen(false);
              }}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-gray-400 hover:text-white hover:bg-white/[0.04] transition-all duration-300"
            >
              <Command className="w-5 h-5" />
              <span className="font-medium">Search &amp; commands</span>
              <span className="ml-auto num text-xs text-gray-600">{paletteHint}</span>
            </button>
            <div className="pt-4 border-t border-white/[0.04] flex items-center justify-between">
              <ProfileSwitch />
              <ConnectWallet />
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}
