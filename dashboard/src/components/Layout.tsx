import { Outlet, useLocation } from 'react-router-dom';
import Header from './Header';
import DemoControlBar from './DemoControlBar';
import { CommandPalette } from './CommandPalette';
import { EpochProgress } from './ui/EpochProgress';
import { ServicesBanner } from './ui/ServicesBanner';
import { useWalletSync } from '../hooks/useWalletSync';
import { useEercBridge } from '../hooks/useEercBridge';
import { useL1AutoConnect } from '../hooks/useL1AutoConnect';
import { useMarketData } from '../hooks/useMarketData';
import { useMyData } from '../hooks/useMyData';
import { useGlobalEvents } from '../hooks/useGlobalEvents';
import { TAGLINE } from '../config';

export default function Layout() {
  const location = useLocation();
  useWalletSync();
  useEercBridge();
  useL1AutoConnect();
  // Global liveness: hydrate market + session once here so every route is live
  // (header ticker, epoch bar, global toasts). Pages read from the stores.
  useMarketData();
  useMyData();
  useGlobalEvents();

  return (
    <div className="min-h-screen bg-surface-0 relative">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[60] focus:top-4 focus:left-4 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-benchmark-600 focus:text-surface-0 focus:text-sm focus:font-semibold"
      >
        Skip to main content
      </a>

      {/* Ambient background layers */}
      <div className="mesh-bg" />
      <div className="grid-pattern" />
      <div className="noise-overlay" />
      <div className="scanlines" />

      <div className="relative z-10">
        <Header />
        <EpochProgress />
        <ServicesBanner />
        <div className="divider-glow" />
        <main
          id="main-content"
          key={location.pathname}
          className="container mx-auto px-4 sm:px-6 lg:px-8 py-10 pb-28 animate-fade-in"
        >
          <Outlet />
        </main>
        <DemoControlBar />
        <CommandPalette />
        <footer className="relative border-t border-white/[0.04] mt-8">
          <div className="divider-glow opacity-30" />
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <div className="w-5 h-5 rounded-md bg-benchmark-600/20 flex items-center justify-center">
                  <div className="w-2.5 h-2.5 rounded-sm bg-benchmark-500/60" />
                </div>
                <span className="font-semibold text-gray-400">THE WINDOW</span>
                <span className="text-gray-700">|</span>
                <span>Private machine money market on Avalanche</span>
              </div>
              <p className="text-gray-600 text-xs italic">“{TAGLINE}”</p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
