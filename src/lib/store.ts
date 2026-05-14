import { create } from "zustand";
import type { RateLimitInfo } from "@/lib/github/octokit";
import { SETTINGS_DEFAULTS, type BeetSettings } from "@/lib/storage/settings";

export interface AppStore {
  // Server state lives in React Query. This store holds only client/UI state.

  // rateLimit is cross-cutting: written imperatively by the Octokit response
  // interceptor (every API call) and by token validation. No single query
  // owns it, so the store is its canonical home.
  rateLimit: RateLimitInfo | null;

  // null = use settings.showAllApproved; true|false = session override.
  showAllReviewsOverride: boolean | null;

  uiError: string | null;

  selectedItemId: string | null;

  settings: BeetSettings;
  settingsHydrated: boolean;

  setRateLimit: (rateLimit: RateLimitInfo | null) => void;
  setShowAllReviewsOverride: (value: boolean | null) => void;
  setUiError: (message: string | null) => void;
  setSelectedItemId: (id: string | null) => void;
  setSettings: (settings: Partial<BeetSettings>) => void;
  hydrateSettings: (settings: BeetSettings) => void;

  reset: () => void;
}

const initialState = {
  rateLimit: null as RateLimitInfo | null,
  showAllReviewsOverride: null as boolean | null,
  uiError: null as string | null,
  selectedItemId: null as string | null,
  settings: SETTINGS_DEFAULTS,
  settingsHydrated: false,
};

export const useAppStore = create<AppStore>((set) => ({
  ...initialState,
  setRateLimit: (rateLimit) => set({ rateLimit }),
  setShowAllReviewsOverride: (value) => set({ showAllReviewsOverride: value }),
  setUiError: (message) => set({ uiError: message }),
  setSelectedItemId: (id) => set({ selectedItemId: id }),
  setSettings: (partial) =>
    set((state) => ({ settings: { ...state.settings, ...partial } })),
  hydrateSettings: (settings) => set({ settings, settingsHydrated: true }),
  reset: () => set(initialState),
}));

// Resolved Show-All for the Review Requests section.
// Override (session-scoped) wins over the persisted global default.
export function selectShowAllReviews(s: AppStore): boolean {
  return s.showAllReviewsOverride ?? s.settings.showAllApproved;
}
