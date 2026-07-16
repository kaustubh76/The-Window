import { Component, ReactNode, lazy, Suspense } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { AlertTriangle, RefreshCw, Loader2, Home } from 'lucide-react';
import Layout from './components/Layout';
import { RoleGate } from './components/RoleGate';
import { ToastProvider } from './contexts/ToastContext';
import { IS_L1 } from './config';

// Route-level code splitting.
const MarketHome = lazy(() => import('./pages/MarketHome'));
const Explorer = lazy(() => import('./pages/Explorer'));
const L1 = lazy(() => import('./pages/L1'));
const Methodology = lazy(() => import('./pages/Methodology'));
const Diagnostics = lazy(() => import('./pages/Diagnostics'));
const Console = lazy(() => import('./pages/Console'));
const WalletPage = lazy(() => import('./pages/WalletPage'));
const AuctionPage = lazy(() => import('./pages/AuctionPage'));
const PositionsPage = lazy(() => import('./pages/PositionsPage'));
const AdminConsole = lazy(() => import('./pages/AdminConsole'));
const KeeperConsole = lazy(() => import('./pages/KeeperConsole'));

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 animate-fade-in text-center">
      <div className="text-[120px] font-bold leading-none tracking-tighter num bg-gradient-to-b from-gray-600 to-gray-800 bg-clip-text text-transparent select-none">
        404
      </div>
      <h1 className="text-2xl font-bold text-white mb-2 tracking-tight">Page not found</h1>
      <p className="text-gray-400 mb-8 text-sm max-w-md">This page doesn’t exist or has moved.</p>
      <Link to="/" className="btn btn-primary inline-flex items-center gap-2">
        <Home className="w-4 h-4" /> Go to Market
      </Link>
    </div>
  );
}

interface EBState {
  hasError: boolean;
  error: Error | null;
}
class ErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error): EBState {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-surface-0 flex items-center justify-center p-4">
          <div className="max-w-md w-full text-center animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-signal-down/10 border border-signal-down/20 flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-8 h-8 text-signal-down" />
            </div>
            <h1 className="text-xl font-bold text-white mb-2 tracking-tight">Something went wrong</h1>
            <p className="text-gray-400 mb-3 text-sm">An unexpected error occurred. Try reloading.</p>
            {this.state.error?.message && (
              <div className="bg-signal-down/5 border border-signal-down/20 rounded-xl p-3 mb-6">
                <p className="text-signal-down text-xs num break-all">{this.state.error.message}</p>
              </div>
            )}
            <button onClick={() => window.location.reload()} className="btn btn-primary inline-flex items-center gap-2">
              <RefreshCw className="w-4 h-4" /> Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <Suspense
          fallback={
            <div className="min-h-screen bg-surface-0 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-benchmark-400 animate-spin" />
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<MarketHome />} />
              <Route path="explorer" element={<Explorer />} />
              {/* L1 story panel — only on the permissioned L1 deployment (43117) */}
              {IS_L1 && <Route path="l1" element={<L1 />} />}
              <Route path="methodology" element={<Methodology />} />
              <Route path="diagnostics" element={<Diagnostics />} />
              <Route path="app" element={<RoleGate need="member"><Console /></RoleGate>} />
              <Route path="app/wallet" element={<RoleGate need="connected"><WalletPage /></RoleGate>} />
              <Route path="app/auction" element={<RoleGate need="member"><AuctionPage /></RoleGate>} />
              <Route path="app/positions" element={<RoleGate need="member"><PositionsPage /></RoleGate>} />
              <Route path="ops/admin" element={<RoleGate need="admin"><AdminConsole /></RoleGate>} />
              <Route path="ops/keeper" element={<RoleGate need="keeper"><KeeperConsole /></RoleGate>} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </ToastProvider>
    </ErrorBoundary>
  );
}
