import { create } from 'zustand';
import { PROFILE, type Profile } from '../config';

// Small UI-level store. Canonical DEMO/PROD profile lives here so the ProfileSwitch
// is interactive; the DemoEngine clock (Phase 3) reads and syncs to it.
interface UiState {
  profile: Profile;
  setProfile: (p: Profile) => void;
}

export const useUiStore = create<UiState>((set) => ({
  profile: PROFILE,
  setProfile: (profile) => set({ profile }),
}));
