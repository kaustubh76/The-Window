import { useState, useCallback } from 'react';
import type { OnProof, ProofProgress, TxResult } from '../lib/adapter/types';

// Wraps any proof-bearing adapter write, threading onProof into a phase state machine.
// Surfaces honest copy: "building witness…" → "generating proof…" → "verifying…" → "verified ✓".
export function useTx() {
  const [progress, setProgress] = useState<ProofProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T extends TxResult>(fn: (onP: OnProof) => Promise<T>): Promise<T> => {
    setRunning(true);
    setError(null);
    setProgress({ phase: 'building-witness', label: 'starting…' });
    try {
      const res = await fn((p) => setProgress(p));
      if (!res.ok) {
        setError(res.error ?? 'transaction failed');
        setProgress({ phase: 'error', label: res.error ?? 'failed' });
      }
      return res;
    } catch (e) {
      const m = e instanceof Error ? e.message : 'transaction failed';
      setError(m);
      setProgress({ phase: 'error', label: m });
      return { ok: false, error: m } as T;
    } finally {
      setRunning(false);
      window.setTimeout(() => setProgress((p) => (p?.phase === 'done' || p?.phase === 'error' ? null : p)), 2200);
    }
  }, []);

  return { run, progress, running, error };
}
