import { create } from 'zustand';
import { useAdapterStore } from './useAdapterStore';
import { hasDemoControls } from '../lib/adapter/WindowAdapter';
import { DEFAULT_SCENARIO } from '../lib/adapter/mock/scenarios';

function controls() {
  const a = useAdapterStore.getState().adapter;
  return a && hasDemoControls(a) ? a : null;
}

interface DemoState {
  playing: boolean;
  speed: number;
  scenario: string;
  seed: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setSpeed: (n: number) => void;
  seek: (ms: number) => void;
  reseed: (seed: number) => void;
  loadScenario: (name: string) => void;
  stepEpoch: () => void;
}

export const useDemoStore = create<DemoState>((set, get) => ({
  playing: true,
  speed: 1,
  scenario: DEFAULT_SCENARIO.name,
  seed: DEFAULT_SCENARIO.params.seed,

  play: () => {
    controls()?.play();
    set({ playing: true });
  },
  pause: () => {
    controls()?.pause();
    set({ playing: false });
  },
  toggle: () => (get().playing ? get().pause() : get().play()),
  setSpeed: (n) => {
    controls()?.setSpeed(n);
    set({ speed: n });
  },
  seek: (ms) => controls()?.seek(ms),
  reseed: (seed) => {
    controls()?.reseed(seed);
    set({ seed, playing: true });
  },
  loadScenario: (name) => {
    controls()?.loadScenario(name);
    set({ scenario: name, playing: true });
  },
  stepEpoch: () => controls()?.stepEpoch(),
}));
