import { useEffect, useRef, useState } from 'react';

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// Eases a displayed number toward `target` via requestAnimationFrame (easeOutCubic).
// Snaps instantly under prefers-reduced-motion. Used for the M-ONIA rate odometer.
export function useAnimatedNumber(target: number, durationMs = 550): number {
  const [value, setValue] = useState(target);
  const raf = useRef(0);
  const valueRef = useRef(target);
  valueRef.current = value;

  useEffect(() => {
    if (durationMs <= 0 || prefersReducedMotion()) {
      setValue(target);
      return;
    }
    const from = valueRef.current;
    const delta = target - from;
    if (Math.abs(delta) < 1e-9) return;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / durationMs);
      setValue(from + delta * easeOutCubic(t));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return value;
}
