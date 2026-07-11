import { useEffect, useRef } from 'react';

export interface ShortcutHandlers {
  onTogglePlay?: () => void;
  onScrub?: (dir: -1 | 1) => void;
  onReseed?: () => void;
  onSpeed?: (mult: number) => void;
  onNextScenario?: () => void;
  enabled?: boolean;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

// Global demo shortcuts. Ignored while typing in a field. Handlers are read from a ref so
// the listener is registered once (stable) regardless of render churn.
export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = ref.current;
      if (h.enabled === false || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          h.onTogglePlay?.();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          h.onScrub?.(-1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          h.onScrub?.(1);
          break;
        case 'r':
        case 'R':
          h.onReseed?.();
          break;
        case 's':
        case 'S':
          h.onNextScenario?.();
          break;
        case '1':
          h.onSpeed?.(0.5);
          break;
        case '2':
          h.onSpeed?.(1);
          break;
        case '3':
          h.onSpeed?.(2);
          break;
        case '4':
          h.onSpeed?.(4);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
