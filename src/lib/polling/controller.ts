// Pure adaptive-polling multiplier (§7). No I/O, no Tauri — easy to unit-test.
//
// Max-wins semantics: each signal contributes a candidate multiplier; the
// largest one wins. Signals do NOT compound with each other (×2 hidden + ×2
// battery ≠ ×4; either gives ×2 unless rate-limit pressure is also active).
//
// The actual poll loop lives in Rust (src-tauri/src/poller/adaptive.rs) and
// uses multiplication semantics. This frontend copy is used for:
// 1. Unit-testable documentation of the §7 policy.
// 2. Driving a pollingState Zustand slice that the Settings UI can display.
//
// NOTE: computeMultiplier is intentionally not wired to the Rust poll interval.
// The Rust side is the ground truth. The frontend value is for UI display only
// (e.g. PollingTab showing "currently polling every ~60s"). Wire it up by
// subscribing to the relevant store slices and passing the result to PollingTab.

export interface PollingSignals {
  windowHidden: boolean;
  onBattery: boolean;
  rateLimitRemaining: number;
  hasInFlight: boolean;
  hasPinnedRepos: boolean;
}

export function computeMultiplier(s: PollingSignals): number {
  // Pinned repos always get the fast interval — overrides everything else.
  if (s.hasPinnedRepos) return 1;
  // Rate-limit pressure: slow down dramatically to avoid burning the bucket.
  if (s.rateLimitRemaining < 100) return 4;
  // In-flight items need fresh data fast.
  if (s.hasInFlight) return 1;
  // Window hidden or on battery: back off but stay connected.
  if (s.windowHidden || s.onBattery) return 2;
  return 1;
}
