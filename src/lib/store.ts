import { create } from "zustand";
import type { AuthValidation } from "@/lib/github/auth";
import type { RateLimitInfo } from "@/lib/github/octokit";
import type { ActionableItem } from "@/lib/types";
import { SETTINGS_DEFAULTS, type BeetSettings } from "@/lib/storage/settings";

export interface AppStore {
  token: string | null;
  user: { login: string } | null;
  rateLimit: RateLimitInfo | null;
  auth: AuthValidation | null;

  reviewRequests: ActionableItem[];
  inFlight: ActionableItem[];
  standaloneRuns: ActionableItem[];
  recentlyResolved: ActionableItem[];

  // null = use settings.showAllApproved; true|false = session override.
  showAllReviewsOverride: boolean | null;

  uiError: string | null;

  settings: BeetSettings;
  settingsHydrated: boolean;

  setToken: (token: string | null) => void;
  setUser: (user: { login: string } | null) => void;
  setRateLimit: (rateLimit: RateLimitInfo | null) => void;
  setAuth: (auth: AuthValidation | null) => void;

  setReviewRequests: (items: ActionableItem[]) => void;
  setInFlight: (items: ActionableItem[]) => void;
  setStandaloneRuns: (items: ActionableItem[]) => void;
  setRecentlyResolved: (items: ActionableItem[]) => void;

  setShowAllReviewsOverride: (value: boolean | null) => void;

  setUiError: (message: string | null) => void;

  setSettings: (settings: Partial<BeetSettings>) => void;
  hydrateSettings: (settings: BeetSettings) => void;

  reset: () => void;
}

const initialState = {
  token: null,
  user: null,
  rateLimit: null,
  auth: null,
  reviewRequests: [] as ActionableItem[],
  inFlight: [] as ActionableItem[],
  standaloneRuns: [] as ActionableItem[],
  recentlyResolved: [] as ActionableItem[],
  showAllReviewsOverride: null as boolean | null,
  uiError: null as string | null,
  settings: SETTINGS_DEFAULTS,
  settingsHydrated: false,
};

export const useAppStore = create<AppStore>((set) => ({
  ...initialState,
  setToken: (token) => set({ token }),
  setUser: (user) => set({ user }),
  setRateLimit: (rateLimit) => set({ rateLimit }),
  setAuth: (auth) =>
    set({ auth, user: auth?.login ? { login: auth.login } : null }),

  setReviewRequests: (items) => set({ reviewRequests: items }),
  setInFlight: (items) => set({ inFlight: items }),
  setStandaloneRuns: (items) => set({ standaloneRuns: items }),
  setRecentlyResolved: (items) => set({ recentlyResolved: items }),

  setShowAllReviewsOverride: (value) => set({ showAllReviewsOverride: value }),

  setUiError: (message) => set({ uiError: message }),

  setSettings: (partial) =>
    set((state) => ({ settings: { ...state.settings, ...partial } })),
  hydrateSettings: (settings) =>
    set({ settings, settingsHydrated: true }),

  reset: () => set(initialState),
}));

// Resolved Show-All for the Review Requests section.
// Override (session-scoped) wins over the persisted global default.
export function selectShowAllReviews(s: AppStore): boolean {
  return s.showAllReviewsOverride ?? s.settings.showAllApproved;
}
