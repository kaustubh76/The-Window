import { create } from 'zustand';
import { PROFILE, type Profile } from '../config';

// Small UI-level store. The canonical, reactive DEMO/PROD profile lives here — every profile
// label / min-bid / Diagnostics reads it. ProfileSwitch is the sole writer and also bridges to
// adapter.setProfile() so the mock clock re-paces in lockstep (see ProfileSwitch.tsx).
interface UiState {
  profile: Profile;
  setProfile: (p: Profile) => void;
}

export const useUiStore = create<UiState>((set) => ({
  profile: PROFILE,
  setProfile: (profile) => set({ profile }),
}));
