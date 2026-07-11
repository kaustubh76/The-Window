import { useEffect, useRef } from 'react';
import { useAdapterStore } from '../stores/useAdapterStore';
import { useToast } from '../contexts/ToastContext';
import { bpsToPctLabel } from '../lib/rates';
import type { WindowEvent } from '../lib/adapter/types';

// Global market notifications — mounted once in Layout so key events surface on every
// route. Deduped by epoch/loan id (so a scrub→replay never re-toasts) and throttled so the
// stream reads as alive, not spammy.
export function useGlobalEvents() {
  const init = useAdapterStore((s) => s.init);
  const toast = useToast();
  const lastAt = useRef(0);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    let unsub = () => {};
    init().then((a) => {
      if (!a || !alive) return;
      unsub = a.subscribe((e: WindowEvent) => {
        const now = performance.now();
        let key: string | null = null;
        let text = '';
        let type: 'success' | 'info' | 'warning' = 'info';

        if (e.type === 'RatePrinted') {
          key = `print-${e.print.epoch}`;
          text = `M-ONIA printed ${e.print.rStarBps != null ? bpsToPctLabel(e.print.rStarBps) : 'no-trade'} · epoch ${e.print.epoch}`;
          type = e.print.stale ? 'warning' : 'success';
        } else if (e.type === 'LoanSeized') {
          key = `seize-${e.loanId}`;
          text = `Collateral seized · loan ${e.loanId}`;
          type = 'warning';
        } else {
          return;
        }

        if (seen.current.has(key)) return;
        if (now - lastAt.current < 1200) return; // throttle bursts
        seen.current.add(key);
        if (seen.current.size > 200) seen.current.clear();
        lastAt.current = now;
        toast.showToast(text, type);
      });
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [init, toast]);
}
