import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { X, AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const TOAST_DURATION = 5000;

const toastIcons = { success: CheckCircle, error: AlertCircle, warning: AlertTriangle, info: Info };
const toastStyles = {
  success: 'bg-signal-up/5 border-signal-up/20 text-signal-up',
  error: 'bg-signal-down/5 border-signal-down/20 text-signal-down',
  warning: 'bg-signal-stale/5 border-signal-stale/20 text-signal-stale',
  info: 'bg-cipher-500/5 border-cipher-500/20 text-cipher-300',
};
const toastIconStyles = {
  success: 'bg-signal-up/10 text-signal-up',
  error: 'bg-signal-down/10 text-signal-down',
  warning: 'bg-signal-stale/10 text-signal-stale',
  info: 'bg-cipher-500/10 text-cipher-300',
};

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = `t-${counter++}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION);
  }, []);

  const success = useCallback((m: string) => showToast(m, 'success'), [showToast]);
  const error = useCallback((m: string) => showToast(m, 'error'), [showToast]);
  const info = useCallback((m: string) => showToast(m, 'info'), [showToast]);
  const warning = useCallback((m: string) => showToast(m, 'warning'), [showToast]);

  const removeToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ showToast, success, error, info, warning }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2.5 max-w-sm">
        {toasts.map((toast) => {
          const Icon = toastIcons[toast.type];
          return (
            <div
              key={toast.id}
              className={`flex items-start gap-3 p-4 rounded-xl border backdrop-blur-xl shadow-2xl animate-slide-in-right ${toastStyles[toast.type]}`}
              role="alert"
              aria-live="polite"
            >
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${toastIconStyles[toast.type]}`}>
                <Icon className="w-4 h-4" />
              </div>
              <p className="flex-1 text-sm font-medium text-white pt-0.5 leading-relaxed">{toast.message}</p>
              <button
                onClick={() => removeToast(toast.id)}
                className="flex-shrink-0 text-white/40 hover:text-white transition-all duration-300 p-1 rounded-md hover:bg-white/[0.04]"
                aria-label="Close notification"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}
