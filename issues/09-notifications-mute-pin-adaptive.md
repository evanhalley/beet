# #9 — OS notifications + mute/pin + adaptive polling

Light up the three behaviors that make Beet feel like a finished ambient app: native OS notifications for the five [§10](../SPECS.md) triggers (with dedupe), real Mute & Pin filtering, and adaptive polling that respects window visibility, battery state, and rate-limit pressure.

Refs: [SPECS §7 adaptive polling + rate-limit reaction](../SPECS.md), [§8 mute & pin](../SPECS.md), [§9 `notifications_sent` / `mute_rules` / `pin_rules`](../SPECS.md), [§10 the 5 triggers + dedupe keys](../SPECS.md). Builds on [#7](https://github.com/evanhalley/beet/issues/24) (tray + window-close-≠-quit) and [#8](https://github.com/evanhalley/beet/issues/25) (fingerprints + Needs Action Now).

## Goal

All five OS notifications from §10 fire, dedupe correctly, and respect per-trigger toggles in Settings. Mute and Pin work end-to-end: muting a repo removes its items from every section and the badge; pinning a repo forces fast-interval polling and visually marks rows. Polling intervals adapt: ×2 when the main window is hidden, ×2 on battery / power-save, ×4 when `X-RateLimit-Remaining < 100`, and the fast lane (×1) is reserved for in-flight items and pinned repos.

## Acceptance criteria

### OS notifications (the 5 §10 triggers)

- [ ] **`src/hooks/useNotifications.ts`** — extend the placeholder hook (or port from Action Jackson `useNotifications.ts`) to handle all five triggers. Permission is requested on first launch (one-time prompt, persisted).
- [ ] **Diff-based dispatch.** On every poll-result delivered by the Rust poller, the frontend computes the diff against the previous tick and emits notifications for:
  | Trigger | Detection | Dedupe key |
  |---|---|---|
  | Ejected from merge queue | item went from `lifecycle=merge_queue` to non-merge_queue, non-merged (from `pr_lifecycle_history` in #5) | `eject:{prId}:{ejectionAt}` |
  | Failing checks on your PR | `pr.checks.state` transitioned to `failure` on a PR you authored | `checks-fail:{prId}:{headSha}` |
  | New review request for you | item appeared in Review Requests this tick | `review-req:{prId}` |
  | Comment / @mention | new `pr.activity.mentionsMe` event id from #8's notifications route | `mention:{commentId}` |
  | Workflow run finished | `run.status` transitioned to `completed` (for standalone runs) | `run:{runId}:{conclusion}` |
- [ ] **`notifications_sent` dedupe.** SQLite migration v7:
  ```sql
  CREATE TABLE notifications_sent (
    dedupe_key TEXT PRIMARY KEY,
    fired_at TEXT NOT NULL
  );
  ```
  Each `sendNotification` call writes its key first inside a transaction — `INSERT OR IGNORE`; if `changes() = 0`, skip the notification.
- [ ] **Per-trigger toggles** in Settings — five boolean settings (default: all on except PR-check successes per §10, which doesn't fire by default anyway). Toggles persist in `settings` table (existing).
- [ ] **DND respected.** No special handling — `@tauri-apps/plugin-notification` delegates to macOS Notification Center which honors Focus modes.

### Mute & Pin

- [ ] **SQLite migration v8.** Add:
  ```sql
  CREATE TABLE mute_rules (
    scope TEXT NOT NULL,                    -- 'repo' | 'org'
    value TEXT NOT NULL,                    -- 'owner/repo' or 'owner'
    created_at TEXT NOT NULL,
    PRIMARY KEY (scope, value)
  );
  CREATE TABLE pin_rules (
    value TEXT PRIMARY KEY,                 -- 'owner/repo'
    created_at TEXT NOT NULL
  );
  ```
- [ ] **`src/lib/storage/mutePin.ts`** — `listMutes()`, `listPins()`, `mute(scope, value)`, `unmute(scope, value)`, `pin(repo)`, `unpin(repo)`. All sync to Zustand on change.
- [ ] **Mute is global filter.** Before items hit any selector / section / badge / notification dispatcher, they pass through `applyMutes(items, mutes)` which drops any item whose `repoFullName` matches a `repo` rule or whose `owner` matches an `org` rule. Implemented as a single Zustand selector (`mutedFilteredItems`) so every consumer is auto-filtered.
- [ ] **Pin marks the row + repo.** Pinned repos render a `PinGlyph` (from [design/src/ui.jsx](../design/src/ui.jsx)) in the row's repo label. Sidebar gets a "Pinned" filter chip that scopes the list to pinned-repo items only.
- [ ] **Row context menu** — extend #8's menu with "Mute repo `owner/foo`", "Mute org `owner`", "Pin repo `owner/foo`" (toggles to "Unpin" when already pinned).
- [ ] **Settings panel** — new "Mute & Pin" section listing all rules with remove buttons. Order: pins on top, then repo mutes, then org mutes.

### Adaptive polling

- [ ] **`src/lib/polling/controller.ts`** — `computeMultiplier({ windowHidden, onBattery, rateLimitRemaining, hasInFlight, isPinnedRepo })` returns a number. Rules:
  - `isPinnedRepo === true` → `1` (always fast, overrides everything).
  - `rateLimitRemaining < 100` → `4`.
  - `hasInFlight === true` → `1`.
  - `windowHidden || onBattery` → `2`.
  - else → `1`.
  Combined effect on the actual interval: base interval × multiplier. `rateLimit` × `windowHidden` compounds — if both apply, multiplier is the larger one (this matches §7's text: hidden/battery is ×2 but rate-limit is ×4, and we never multiply them together).
- [ ] **Wired into TanStack Query `refetchInterval`.** Each query's `refetchInterval` is a callback that reads the current multiplier from a Zustand `pollingState` slice and multiplies the base from settings.
- [ ] **Window visibility** — `document.visibilityState` listener (works for both main window and tray popover; the main window is the relevant one).
- [ ] **Battery state** — `navigator.getBattery()` once on launch; subscribes to `chargingchange`. Falls back to "on AC" if unavailable.
- [ ] **Rate-limit signal** — the existing Octokit wrapper already returns `X-RateLimit-Remaining`; surface the latest value in a Zustand `rateLimit` slice on every fetch.
- [ ] **In-flight detection** — `hasInFlight` is true if any item has `pr.lifecycle in ("in_review", "merge_queue")` or `run.status === "in_progress"`.

### Settings additions

- [ ] **Polling interval slider** — 15 s to 600 s, default 60 s. Persisted in `settings`.
- [ ] **Rate-limit display** — read-only chip showing `Remaining: {n} / 5000 · resets at {time}`.
- [ ] **Notification toggles** — the five booleans.
- [ ] **Mute & Pin management** — see above.

## Files to add / modify

```
src-tauri/src/
└── store/db.rs                       ← migrations v7 (notifications_sent), v8 (mute_rules, pin_rules)

src/
├── hooks/useNotifications.ts         ← extend / replace placeholder
├── hooks/useNotifications.test.tsx   ← new
├── lib/
│   ├── storage/
│   │   ├── notifications.ts          ← dedupe DAL
│   │   ├── notifications.test.ts
│   │   ├── mutePin.ts
│   │   └── mutePin.test.ts
│   ├── polling/
│   │   ├── controller.ts             ← computeMultiplier (pure)
│   │   └── controller.test.ts
│   └── store.ts                      ← pollingState + rateLimit + mutes/pins slices, mutedFilteredItems selector
├── components/
│   ├── Settings/
│   │   ├── NotificationsTab.tsx
│   │   ├── MutePinTab.tsx
│   │   └── PollingTab.tsx            (or extend an existing tab — confirm during impl)
│   ├── Sidebar/PinnedFilter.tsx
│   ├── PinGlyph.tsx                  ← port from design/src/ui.jsx
│   └── RowContextMenu.tsx            ← extend #8's menu with real mute/pin actions
```

## Test plan

**Unit (Vitest + MSW)**
- `controller.test.ts` — table-driven over every combination of the five inputs; assert §7 semantics (pinned always 1, rate-limit beats hidden/battery, etc.).
- `notifications.test.ts` — fire the same trigger twice → second is deduped.
- `useNotifications.test.tsx` — for each of the 5 triggers: simulate a poll diff that should fire it, assert `sendNotification` is called once with the expected title/body; second tick with same diff is a no-op.
- `mutePin.test.ts` — mute repo: items from that repo no longer appear in `mutedFilteredItems`; unmute restores them. Mute org: covers all repos under that org. Pin: badge unaffected, but `PinGlyph` shows and `isPinnedRepo` returns true for the controller.
- `MutePinTab.test.tsx` — add/remove rules round-trip through SQLite.

**Manual**
- Trigger each of the 5 notifications using fixture state transitions; verify dedupe (run the same poll twice, only one notification fires).
- Mute a noisy repo; items disappear from all five sections and badge decrements within one tick.
- Pin a repo; tail the poller log and confirm that repo's fetch fires on the fast interval even when window is hidden.
- Hide the main window; observe poll cadence × 2 (TanStack Query devtools or poll log).
- Pull the laptop off power; cadence × 2.
- Burn rate-limit down (synthetic via MSW); cadence × 4 with the rate-limit chip in Settings showing red.

## Out of scope

| Concern | Lands in |
|---|---|
| Updater "Restart to update" | #10 |
| Auto-launch on login | #10 |
| Task chips, density / theme toggles | #10 |
| GitHub App / webhooks (replaces polling) | V2 |

## Notes

- **Notification permission UX.** macOS shows the permission prompt once; if the user denies it, surface a Settings banner with a link to System Settings → Notifications. Don't silently swallow `permission = "denied"` — it's a confusing failure mode.
- **Dedupe transaction order.** Always write `notifications_sent` *before* calling `sendNotification`. If the OS notification fails after the row is written, we lose one notification — acceptable. The reverse order (notify first, then write) risks duplicate notifications, which is the worse failure.
- **Rate-limit reset.** When rate-limit recovers (remaining ≥ 100), the multiplier drops back; the controller is pure so this happens on the next tick that reads fresh state.
- **`mutedFilteredItems` placement.** Apply mute filtering at the Zustand selector layer (after the poller writes to the store) rather than in the Rust poller. That keeps the poller cache complete (so unmuting doesn't trigger a refetch) and the UI is the only place that needs to respect mute rules.
- **Migration sequencing.** v7 and v8 are independent — order doesn't matter — but stay consistent with the existing monotonic versioning in `db.rs`.
