import { create } from "zustand";
import type { RateLimitInfo } from "@/lib/github/rate-limit";
import type { ActionableItem } from "@/lib/types";
import { SETTINGS_DEFAULTS, type BeetSettings } from "@/lib/storage/settings";

export type PollState = "idle" | "polling" | "ok" | "error";

export interface AutoRequeueError {
  prId: string;
  headSha: string;
  message: string;
}

// Payloads emitted by the Rust poll loop (src-tauri/src/poller/poll_loop.rs).
export interface PollResultPayload {
  reviewRequests: ActionableItem[];
  inFlight: ActionableItem[];
  // Workflow runs the user triggered that didn't collapse into a tracked PR
  // (#6 / SPECS §7). Includes push-event runs without a PR. Optional on the
  // type so older test fixtures and pre-#6 payloads still type-check; the
  // store coerces missing values to an empty array.
  standaloneRuns?: ActionableItem[];
  // Merged/closed PRs + completed runs from the last 24h (#6 / SPECS §5).
  recentlyResolved?: ActionableItem[];
  rateLimit: RateLimitInfo | null;
  polledAt: string;
  autoRequeueErrors?: AutoRequeueError[];
}

export interface PollStatusPayload {
  state: PollState;
  error: string | null;
  rateLimited: boolean;
  // Seconds GitHub asked us to wait before retrying — set on rate-limit
  // errors, null otherwise. Available for Phase 5's adaptive polling.
  retryAfterSecs: number | null;
}

export interface AppStore {
  // Server state is owned by the Rust poll loop and pushed in via Tauri
  // events (see usePollEvents); this store is its canonical home on the
  // frontend. Everything else here is client/UI state.
  reviewRequests: ActionableItem[];
  inFlight: ActionableItem[];
  standaloneRuns: ActionableItem[];
  recentlyResolved: ActionableItem[];
  // Flat lookup across every section, for resolving a selected item by id.
  byId: Map<string, ActionableItem>;
  pollState: PollState;
  lastPolledAt: string | null;
  // Error from the most recent poll cycle, if it failed. Distinct from
  // `uiError`, which is for frontend-originated errors (clipboard, open URL).
  pollError: string | null;
  rateLimited: boolean;
  retryAfterSecs: number | null;
  rateLimit: RateLimitInfo | null;
  // UI intent to pause polling; mirrored to the Rust loop via set_poll_paused.
  // Session-only (not persisted) — an app restart resumes polling.
  paused: boolean;

  // null = use settings.showAllApproved; true|false = session override.
  showAllReviewsOverride: boolean | null;

  uiError: string | null;
  // Set of (prId|headSha) pairs the user has already been notified about for
  // auto-requeue failures (#13). Persisting it across poll cycles keeps a
  // failing PR from spamming the toast every interval — one banner per
  // distinct `(prId, headSha)` is enough.
  autoRequeueNotified: Set<string>;

  selectedItemId: string | null;

  settings: BeetSettings;
  settingsHydrated: boolean;

  setPollResult: (payload: PollResultPayload) => void;
  setPollStatus: (payload: PollStatusPayload) => void;
  setPaused: (paused: boolean) => void;
  setRateLimit: (rateLimit: RateLimitInfo | null) => void;
  setShowAllReviewsOverride: (value: boolean | null) => void;
  setUiError: (message: string | null) => void;
  setSelectedItemId: (id: string | null) => void;
  setSettings: (settings: Partial<BeetSettings>) => void;
  hydrateSettings: (settings: BeetSettings) => void;

  reset: () => void;
}

const initialState = {
  reviewRequests: [] as ActionableItem[],
  inFlight: [] as ActionableItem[],
  standaloneRuns: [] as ActionableItem[],
  recentlyResolved: [] as ActionableItem[],
  byId: new Map<string, ActionableItem>(),
  pollState: "idle" as PollState,
  lastPolledAt: null as string | null,
  pollError: null as string | null,
  rateLimited: false,
  retryAfterSecs: null as number | null,
  rateLimit: null as RateLimitInfo | null,
  paused: false,
  showAllReviewsOverride: null as boolean | null,
  uiError: null as string | null,
  autoRequeueNotified: new Set<string>(),
  selectedItemId: null as string | null,
  settings: SETTINGS_DEFAULTS,
  settingsHydrated: false,
};

export const useAppStore = create<AppStore>((set, get) => ({
  ...initialState,
  setPollResult: (payload) => {
    const standaloneRuns = payload.standaloneRuns ?? [];
    const recentlyResolved = payload.recentlyResolved ?? [];
    const byId = new Map<string, ActionableItem>();
    for (const item of payload.reviewRequests) byId.set(item.id, item);
    for (const item of payload.inFlight) byId.set(item.id, item);
    for (const item of standaloneRuns) byId.set(item.id, item);
    // Recently-Resolved rows are reconstructed from a stored snapshot (the
    // PR/run has rotated out of the live poll set). If the same id is still
    // present in a live section, that richer row wins — don't overwrite.
    for (const item of recentlyResolved) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }

    // Dedupe auto-requeue error toasts: a failing (prId, headSha) should
    // only surface once. The set persists across cycles; a new push (new
    // headSha) resets the key naturally.
    const incoming = payload.autoRequeueErrors ?? [];
    let uiError = get().uiError;
    let notified = get().autoRequeueNotified;
    if (incoming.length > 0) {
      notified = new Set(notified);
      for (const err of incoming) {
        const key = `${err.prId}|${err.headSha}`;
        if (!notified.has(key)) {
          notified.add(key);
          uiError = `Auto-requeue failed for ${err.prId}: ${err.message}`;
        }
      }
    }

    set({
      reviewRequests: payload.reviewRequests,
      inFlight: payload.inFlight,
      standaloneRuns,
      recentlyResolved,
      byId,
      rateLimit: payload.rateLimit,
      lastPolledAt: payload.polledAt,
      autoRequeueNotified: notified,
      uiError,
    });
  },
  setPollStatus: (payload) =>
    set({
      pollState: payload.state,
      rateLimited: payload.rateLimited,
      retryAfterSecs: payload.retryAfterSecs,
      pollError: payload.state === "error" ? payload.error : null,
    }),
  setPaused: (paused) => set({ paused }),
  setRateLimit: (rateLimit) => set({ rateLimit }),
  setShowAllReviewsOverride: (value) => set({ showAllReviewsOverride: value }),
  setUiError: (message) => set({ uiError: message }),
  setSelectedItemId: (id) => set({ selectedItemId: id }),
  setSettings: (partial) =>
    set((state) => ({ settings: { ...state.settings, ...partial } })),
  hydrateSettings: (settings) => set({ settings, settingsHydrated: true }),
  reset: () =>
    set({
      ...initialState,
      byId: new Map(),
      autoRequeueNotified: new Set(),
    }),
}));

// Resolved Show-All for the Review Requests section.
// Override (session-scoped) wins over the persisted global default.
export function selectShowAllReviews(s: AppStore): boolean {
  return s.showAllReviewsOverride ?? s.settings.showAllApproved;
}

// Visibility predicate shared by the Review Requests section, the Sidebar
// count, and selection resolution: with Show-All off, only positive-score
// items are visible. Rust scores every review-request but never filters,
// so this is the single point that decides what the user actually sees.
export function isReviewRequestVisible(
  item: ActionableItem,
  showAll: boolean,
): boolean {
  return showAll || (item.pr?.score ?? 0) > 0;
}
