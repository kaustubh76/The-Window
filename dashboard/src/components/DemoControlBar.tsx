import { useState, useEffect } from 'react';
import { Play, Pause, SkipForward, FlaskConical, RotateCcw, Keyboard } from 'lucide-react';
import clsx from 'clsx';
import { useDemoStore } from '../stores/useDemoStore';
import { useClock } from '../hooks/useClock';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { SCENARIOS } from '../lib/adapter/mock/scenarios';
import { ADAPTER_MODE } from '../config';

const SPEEDS = [0.5, 1, 2, 4];
const SHORTCUTS = 'Space play/pause · ←→ scrub · 1-4 speed · S scenario · R reseed';

// Fixed bottom control bar — mock mode only. Seeded + virtual-clock => deterministic
// replay, safe for a live pitch.
export default function DemoControlBar() {
  const { playing, speed, scenario, seed, toggle, setSpeed, seek, reseed, loadScenario } = useDemoStore();
  const clock = useClock();
  const [seedInput, setSeedInput] = useState(String(seed));
  // First-run cue: glow briefly so a judge notices the bar is drivable. Self-dismisses.
  const [hinted, setHinted] = useState(true);

  const now = clock?.now ?? 0;
  const epochLen = clock?.epochLenMs ?? 22_000;
  const openedAt = clock?.openedAt ?? 0;
  const max = Math.max(now, epochLen * 4);
  const scrubStep = Math.max(1000, epochLen * 0.08);
  // The engine prints near epoch end (~0.88·L); 0.9·L lands just past a fresh print.
  const printAt = openedAt + 0.9 * epochLen;
  const nextPrintMs = now < printAt ? printAt : openedAt + epochLen + 0.9 * epochLen;
  const secsToPrint = Math.max(0, Math.ceil((nextPrintMs - now) / 1000));

  useEffect(() => setSeedInput(String(seed)), [seed]);
  useEffect(() => {
    const t = setTimeout(() => setHinted(false), 6000);
    return () => clearTimeout(t);
  }, []);

  useKeyboardShortcuts({
    onTogglePlay: toggle,
    onScrub: (dir) => seek(Math.max(0, now + dir * scrubStep)),
    onReseed: () => reseed(seed + 1),
    onSpeed: setSpeed,
    onNextScenario: () => {
      const i = SCENARIOS.findIndex((s) => s.name === scenario);
      loadScenario(SCENARIOS[(i + 1) % SCENARIOS.length].name);
    },
    enabled: ADAPTER_MODE === 'mock',
  });

  if (ADAPTER_MODE !== 'mock') return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[min(920px,94vw)]">
      <div
        onMouseDown={() => setHinted(false)}
        className={clsx(
          'glass px-3 py-2.5 flex items-center gap-3 shadow-2xl transition-shadow',
          hinted && 'ring-2 ring-benchmark-500/40 animate-glow-pulse',
        )}
      >
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-benchmark-400 num flex-shrink-0">
          <FlaskConical className="w-3.5 h-3.5" />
          <span className="sm:hidden">Drive</span>
          <span className="hidden sm:inline">Drive the simulation</span>
        </span>

        <button
          onClick={toggle}
          className="w-9 h-9 rounded-lg bg-benchmark-500/15 text-benchmark-300 hover:bg-benchmark-500/25 flex items-center justify-center transition-colors flex-shrink-0"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <button
          onClick={() => seek(nextPrintMs)}
          className="h-9 px-2.5 rounded-lg bg-white/[0.04] text-gray-300 hover:bg-white/[0.08] hover:text-white flex items-center gap-1.5 transition-colors flex-shrink-0 num text-[11px]"
          aria-label={`Skip to the next M-ONIA print (about ${secsToPrint} seconds away)`}
          title="Jump to the next M-ONIA print"
        >
          <SkipForward className="w-4 h-4" />
          <span className="hidden sm:inline">next print</span>
          <span className="text-gray-500">~{secsToPrint}s</span>
        </button>

        {/* scrubber */}
        <input
          type="range"
          min={0}
          max={max}
          value={now}
          step={100}
          onChange={(e) => seek(Number(e.target.value))}
          className="flex-1 accent-benchmark-500 h-1.5 cursor-pointer"
          aria-label="Timeline scrubber"
        />

        {/* speed */}
        <div className="hidden md:flex items-center gap-0.5 bg-white/[0.03] rounded-lg p-0.5 border border-white/[0.06]">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={clsx(
                'px-2 py-1 rounded-md text-[11px] font-semibold num transition-colors',
                speed === s ? 'bg-benchmark-500/20 text-benchmark-300' : 'text-gray-500 hover:text-gray-300',
              )}
            >
              {s}×
            </button>
          ))}
        </div>

        {/* scenario */}
        <select
          value={scenario}
          onChange={(e) => loadScenario(e.target.value)}
          className="hidden lg:block bg-surface-1 border border-white/[0.08] rounded-lg text-xs text-gray-300 px-2 py-1.5 focus:outline-none focus:border-benchmark-500/50"
          aria-label="Scenario"
        >
          {SCENARIOS.map((s) => (
            <option key={s.name} value={s.name}>
              {s.label}
            </option>
          ))}
        </select>

        {/* seed */}
        <div className="hidden xl:flex items-center gap-1">
          <input
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value.replace(/\D/g, ''))}
            className="w-14 bg-surface-1 border border-white/[0.08] rounded-lg text-xs num text-gray-300 px-2 py-1.5 focus:outline-none focus:border-benchmark-500/50"
            aria-label="Seed"
          />
          <button
            onClick={() => reseed(Number(seedInput) || 1)}
            className="w-8 h-8 rounded-lg bg-white/[0.04] text-gray-400 hover:text-white flex items-center justify-center"
            title="Re-seed"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* keyboard hint */}
        <div className="hidden sm:flex items-center text-gray-600 cursor-help" title={SHORTCUTS} aria-label={`Keyboard shortcuts: ${SHORTCUTS}`}>
          <Keyboard className="w-4 h-4" />
        </div>
      </div>
    </div>
  );
}
