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
  reviewRequestIds: string[];
  inFlightIds: string[];
  standaloneRunIds: string[];
  recentlyResolvedIds: string[];

  // null = use settings.showAllApproved; true|false = session override.
  showAllReviewsOverride: boolean | null;

  uiError: string | null;

  selectedItemId: string | null;

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

  setSelectedItemId: (id: string | null) => void;

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
  reviewRequestIds: [] as string[],
  inFlightIds: [] as string[],
  standaloneRunIds: [] as string[],
  recentlyResolvedIds: [] as string[],
  showAllReviewsOverride: null as boolean | null,
  uiError: null as string | null,
  selectedItemId: null as string | null,
  settings: SETTINGS_DEFAULTS,
  settingsHydrated: false,
};

type SectionKey =
  | "reviewRequestIds"
  | "inFlightIds"
  | "standaloneRunIds"
  | "recentlyResolvedIds";

const SECTION_KEYS: SectionKey[] = [
  "reviewRequestIds",
  "inFlightIds",
  "standaloneRunIds",
  "recentlyResolvedIds",
];

function applySection(
  state: Pick<
    AppStore,
    | "actionableItems"
    | "reviewRequestIds"
    | "inFlightIds"
    | "standaloneRunIds"
    | "recentlyResolvedIds"
  >,
  section: SectionKey,
  items: ActionableItem[],
) {
  const nextIds = items.map((it) => it.id);
  const mergedItems = { ...state.actionableItems };
  for (const item of items) {
    mergedItems[item.id] = item;
  }
  const nextSectionLists = { ...state, [section]: nextIds };
  // GC: drop any actionable item not referenced by any section list.
  const referenced = new Set<string>();
  for (const key of SECTION_KEYS) {
    for (const id of nextSectionLists[key]) referenced.add(id);
  }
  for (const id of Object.keys(mergedItems)) {
    if (!referenced.has(id)) delete mergedItems[id];
  }
  return {
    actionableItems: mergedItems,
    [section]: nextIds,
  } as Partial<AppStore>;
}

export const useAppStore = create<AppStore>((set) => ({
  ...initialState,
  setToken: (token) => set({ token }),
  setUser: (user) => set({ user }),
  setRateLimit: (rateLimit) => set({ rateLimit }),
  setAuth: (auth) =>
    set({ auth, user: auth?.login ? { login: auth.login } : null }),

  setReviewRequests: (items) =>
    set((s) => applySection(s, "reviewRequestIds", items)),
  setInFlight: (items) => set((s) => applySection(s, "inFlightIds", items)),
  setStandaloneRuns: (items) =>
    set((s) => applySection(s, "standaloneRunIds", items)),
  setRecentlyResolved: (items) =>
    set((s) => applySection(s, "recentlyResolvedIds", items)),

  setShowAllReviewsOverride: (value) => set({ showAllReviewsOverride: value }),

  setUiError: (message) => set({ uiError: message }),

  setSelectedItemId: (id) => set({ selectedItemId: id }),

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

function pluckItems(s: AppStore, ids: string[]): ActionableItem[] {
  const out: ActionableItem[] = [];
  for (const id of ids) {
    const it = s.actionableItems[id];
    if (it) out.push(it);
  }
  return out;
}

export function selectReviewRequests(s: AppStore): ActionableItem[] {
  return pluckItems(s, s.reviewRequestIds);
}

export function selectInFlight(s: AppStore): ActionableItem[] {
  return pluckItems(s, s.inFlightIds);
}

export function selectStandaloneRuns(s: AppStore): ActionableItem[] {
  return pluckItems(s, s.standaloneRunIds);
}

export function selectRecentlyResolved(s: AppStore): ActionableItem[] {
  return pluckItems(s, s.recentlyResolvedIds);
}

export function selectSelectedItem(s: AppStore): ActionableItem | null {
  if (!s.selectedItemId) return null;
  return s.actionableItems[s.selectedItemId] ?? null;
}
