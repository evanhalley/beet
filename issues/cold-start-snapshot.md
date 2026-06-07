# Instant cold-start paint from a persisted poll snapshot

On cold start Beet shows a full-screen "Loading…" until the first **live** poll cycle finishes — even though GitHub data is already on disk. The data in SQLite is *raw* response bodies (`etag_cache.body_json`, for conditional requests) and lifecycle/run history, none of it a ready-to-render snapshot, and nothing replays it into the UI at boot. The rendered `ActionableItem` lists live only in the in-memory Zustand store, populated exclusively by `poll:result` events, and the loading gate is purely `pollState === "idle"`. So the cache saves bandwidth but not the wait (the first cycle is network-bound: keychain read → `search/issues`, which doesn't honor ETags → per-repo runs fan-out → recompute).

This consolidates the parked "cold start shows Loading despite cached data" finding. Out of scope: rehydrating by replaying `etag_cache` bodies through the build pipeline offline (the alternative "Option B").

Refs: `src/hooks/useActionableItems.ts` (loading gate), `src/components/MainWindow/DetailPane.tsx` (Loading UI), `src-tauri/src/poller/poll_loop.rs` (`run_cycle` / `PollResultPayload`), `src/app/providers.tsx` (startup hydration of settings/mutes/pins only).

## Goal

After Beet has run at least once, relaunching paints the last-known PR/run lists **immediately** (no full-screen Loading), with the existing `PollingDot` signalling a background refresh; the lists update in place when the live cycle returns. A genuinely fresh install (no snapshot) still shows Loading as today.

## Approach

Write the four rendered lists to SQLite at the end of each successful cycle (Rust). On mount the frontend pulls that snapshot via a command and applies it instantly (marked **stale**), then pokes the live cycle. Relax the loading gate so cached data clears it.

## Acceptance criteria

### Rust — persist + read the snapshot

- [ ] **SQLite migration** — append the next migration and bump the asserted `user_version` + table-list in the `db.rs` migration tests:
  ```sql
  CREATE TABLE IF NOT EXISTS poll_snapshot (
      id       INTEGER PRIMARY KEY CHECK (id = 1),  -- single row
      payload  TEXT NOT NULL,   -- JSON: { reviewRequests, inFlight, standaloneRuns, recentlyResolved, polledAt }
      saved_at TEXT NOT NULL
  );
  ```
- [ ] **`src-tauri/src/store/snapshot.rs`** (new; add `pub mod snapshot;` to `store/mod.rs`) — a `SnapshotPayload` struct (`#[serde(rename_all = "camelCase")]`) holding the four `Vec<ActionableItem>` lists + `polled_at: String` (`ActionableItem` already derives `Serialize + Deserialize`), plus:
  - `save_snapshot(db, &SnapshotPayload)` → `INSERT OR REPLACE … id = 1`.
  - `#[tauri::command] get_cached_snapshot(db) -> Result<Option<SnapshotPayload>, String>` — read the row and `serde_json::from_str`; on a **deserialize error return `Ok(None)`** so a schema-incompatible snapshot from an older app version is ignored, never fatal.
- [ ] **`src-tauri/src/poller/poll_loop.rs`** — in `run_cycle`, right after the `PollResultPayload` is built and emitted, persist a snapshot from the same lists (best-effort; ignore write errors like the existing prune).
- [ ] **`src-tauri/src/lib.rs`** — register `store::snapshot::get_cached_snapshot` in the invoke handler.

### Frontend — apply on mount + relax loading gate

- [ ] **`src/lib/storage/snapshot.ts`** (new) — `getCachedSnapshot(): Promise<PollResultPayload | null>` wrapping `invoke("get_cached_snapshot")`, fail-safe to `null`. The returned shape is directly consumable by `setPollResult` (`rateLimit` null, no `autoRequeueErrors` — both optional/nullable).
- [ ] **`src/lib/store.ts`** — add `lastResultStale: boolean` (initial `false`); let `setPollResult` mark a result stale (second arg or optional `payload.stale`). Stale apply sets `lastResultStale = true`; a live apply resets it to `false`. Nothing else in `setPollResult` changes — it already sets `lastPolledAt`.
- [ ] **`src/hooks/usePollEvents.ts`** — on mount (both windows; the tray renders data too), before poking: fetch the cached snapshot and apply it **only if** `useAppStore.getState().lastPolledAt === null` (guard against clobbering a live result that already arrived). Keep the existing `refresh_now` poke (main window only).
- [ ] **Loading gate** — change `isLoading` from `pollState === "idle"` to `pollState === "idle" && lastPolledAt === null` in `useActionableItems.ts` and `DetailPane.tsx`. Backward-compatible: tests setting `pollState: "ok"` still short-circuit; a true fresh boot still shows Loading; a cached snapshot clears Loading while `pollState` is still idle. `PollingDot` (`pollState === "polling"`) covers the live-refresh indication.

### Notification behavior (decision)

- [ ] **`src/hooks/useNotifications.ts`** — ignore stale results: add `if (state.lastResultStale) return;` after the existing `if (!state.lastPolledAt) return;` guard. This preserves today's semantics exactly — the first *fresh* cycle establishes the silent baseline, so we do **not** fire a burst of notifications for everything that changed while the app was closed (aligns with the tight notification budget). *Alternative for later:* diff the first fresh cycle against the cached baseline to surface "what changed while you were away" — deliberately not chosen.
- [ ] The tray badge (`useTrayBadge`) intentionally reflects cached counts immediately — no change.

## Tests

- [ ] **Rust** (`store/snapshot.rs`): save→get round-trip; `get_cached_snapshot` returns `None` for an empty table and for malformed JSON. Migration test bumps the asserted version and adds `poll_snapshot` to the table list.
- [ ] **`storage/snapshot.test.ts`**: wrapper invokes the command; returns `null` on throw.
- [ ] **`usePollEvents.test.tsx`**: applies the cached snapshot when `lastPolledAt` is null; does **not** apply when the store already holds a live result.
- [ ] **`useActionableItems` / `DetailPane`**: `isLoading` is false when `lastPolledAt` is set even while `pollState === "idle"`; still true on a fresh boot.
- [ ] **`useNotifications.test.tsx`**: a stale result fires no notifications, and the first subsequent fresh result establishes the baseline silently (no notification for items already present in the stale snapshot).

## Manual verification

1. `npm run tauri dev`, let one cycle complete (data renders).
2. Quit Beet entirely (tray → Quit), relaunch.
3. **Expected:** last-known lists paint immediately (no full-screen "Loading…"), `PollingDot` shows the refresh, lists update in place when the live cycle returns; no notification burst.
4. Sanity: delete `~/Library/Application Support/dev.evanhalley.beet/beet.db` → first launch still shows Loading, as today.
