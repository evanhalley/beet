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

  actionableItems: Record<string, ActionableItem>;
  showAllReviews: boolean;

  settings: BeetSettings;
  settingsHydrated: boolean;

  setToken: (token: string | null) => void;
  setUser: (user: { login: string } | null) => void;
  setRateLimit: (rateLimit: RateLimitInfo | null) => void;
  setAuth: (auth: AuthValidation | null) => void;

  setActionableItems: (items: ActionableItem[]) => void;
  setShowAllReviews: (value: boolean) => void;

  setSettings: (settings: Partial<BeetSettings>) => void;
  hydrateSettings: (settings: BeetSettings) => void;

  reset: () => void;
}

const initialState = {
  token: null,
  user: null,
  rateLimit: null,
  auth: null,
  actionableItems: {} as Record<string, ActionableItem>,
  showAllReviews: SETTINGS_DEFAULTS.showAllApproved,
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

  setActionableItems: (items) =>
    set(() => ({
      actionableItems: Object.fromEntries(items.map((i) => [i.id, i])),
    })),
  setShowAllReviews: (value) => set({ showAllReviews: value }),

  setSettings: (partial) =>
    set((state) => ({ settings: { ...state.settings, ...partial } })),
  hydrateSettings: (settings) =>
    set({
      settings,
      settingsHydrated: true,
      showAllReviews: settings.showAllApproved,
    }),

  reset: () => set(initialState),
}));
