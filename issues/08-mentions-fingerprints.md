# #8 — Mentions hybrid + Needs Action Now + fingerprints

Wire the third actionable signal — @mentions and review-thread replies — and turn on the **Needs Action Now** section that sits above Review Requests. Add the fingerprint machinery from [SPECS §9](../SPECS.md) so unread state and "dismiss until it changes" snooze work end-to-end. This is the densest issue in the plan; if it feels too big it can be split into **8a** (mentions only, no fingerprints) and **8b** (fingerprints + unread/snooze).

Refs: [SPECS §5](../SPECS.md) (`pr.activity.*`), [§7 mentions ingestion (hybrid)](../SPECS.md), [§9 `item_state` + fingerprints](../SPECS.md), [§15 resolved decision #1](../SPECS.md). Builds on [#6](https://github.com/evanhalley/beet/issues/22) (full ActionableItem corpus) and [#7](https://github.com/evanhalley/beet/issues/24) (tray badge consuming the unread count this issue produces).

## Goal

`activity.listNotificationsForAuthenticatedUser` is polled every 60 s with ETag conditional requests; it routes mentions / team mentions / review-reply comments into the right PR's `activity.*` counts. PRs that match the Needs Action Now rule surface in a new top section (above Review Requests) and contribute to the tray badge from #7. Each `ActionableItem` has a computed fingerprint persisted in SQLite; when the fingerprint changes, `unread = 1` (flipping the badge). A row-context-menu "Dismiss until it changes" hides the item until its fingerprint differs.

## Acceptance criteria

### Notifications inbox poll (Rust)

- [ ] **`src-tauri/src/poller/notifications.rs`** — new module. Calls `activity.listNotificationsForAuthenticatedUser` with `all=false`, `participating=false`, `per_page=50`. ETag-cached via existing `etag_cache`; default interval 60 s. Returns a normalized `Vec<NotificationEvent>` to `poll_loop.rs`.
- [ ] **Routing logic** — for each thread:
  - `reason = "mention"` or `"team_mention"` → emit `NotificationEvent::Mention { pr_id }`.
  - `reason = "comment"` AND `subject.type = "PullRequest"` AND the thread's most-recent review-comment author isn't me AND I authored at least one earlier comment on the thread → emit `NotificationEvent::ReplyToMyReview { pr_id }`.
  - `reason = "review_requested"` → drop (already covered by #3's search).
  - Anything else → drop.
  Parse `pr_id` from `subject.url` (regex on `/repos/(.+)/(.+)/pulls/(\d+)`).
- [ ] **Aggregate into `pr.activity`** — in `poll_loop.rs`, after PRs are fetched, fold the unread notification events into matching PRs: `mentionsMe += 1` per mention event whose `updated_at > pr.last_marked_read_at`; same for `replyToMyReview`. Events that don't match any tracked PR are dropped.
- [ ] **Per-PR fallback fetch** — when the detail pane is showing a PR, frontend invokes a new Tauri command `fetch_pr_comments(pr_id)` that calls `issues.listComments` + `pulls.listReviewComments` for that PR only, ETag-cached. Result populates the new ActivityTab. **Not** invoked for off-screen PRs.

### Needs Action Now section

- [ ] **`src/components/NeedsActionSection.tsx`** — new top-of-list section. Inclusion rule (computed in a Zustand selector):
  - item is in `inFlight` OR `reviewRequests`, AND
  - one of: `pr.activity.mentionsMe > 0`, `pr.activity.replyToMyReview > 0`, `pr.checks.state === "failure"`, `pr.mergeQueue?.lastEjectionAt` within last 24h.
- [ ] **Section sits above Review Requests in `ListPane`** — order is now Needs Action Now → Review Requests → In Flight → Standalone Runs → Recently Resolved (matching §5).
- [ ] **Sidebar count** — Triage > Needs Action Now count goes live (was hidden in #4–#7).
- [ ] **Tray badge from #7** — recomputed: `needsAction.unreadCount + reviewRequests.unreadCount`. No change needed to `useTrayBadge` — the selector now sees a populated Needs Action set.

### ActivityTab in DetailPane

- [ ] **`src/components/ActivityTab.tsx`** — new tab in DetailPane (joins existing Body / Reviewers / Checks). Renders the on-demand comment bodies from the fallback fetch. Mentions highlighted, review-thread replies grouped under the original review comment. Shows skeleton while fetching.

### Fingerprints + `item_state`

- [ ] **SQLite migration v6** in `src-tauri/src/store/db.rs`:
  ```sql
  CREATE TABLE item_state (
    id TEXT PRIMARY KEY,
    unread INTEGER NOT NULL DEFAULT 1,
    dismissed_until_fingerprint TEXT,
    last_seen_fingerprint TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  ```
- [ ] **`fingerprintFor(item)`** in `src/lib/storage/fingerprints.ts`:
  - PR: `pr|{lifecycle}|{checks.state}|{activity.mentionsMe}|{activity.replyToMyReview}|{sha1(associatedRuns.map(r => r.id + r.status + r.conclusion).join(","))}`
  - Run: `run|{status}|{conclusion}|{id}`
  Pure function — same input → same output.
- [ ] **`reconcileItemState(items)`** in `src/lib/storage/itemState.ts` — called after every poll:
  1. For each item, compute current fingerprint.
  2. Read existing `item_state` row by id.
  3. If no row → insert with `unread = 1`, `last_seen_fingerprint = current`.
  4. If row exists and `current != last_seen_fingerprint` → set `unread = 1`, `last_seen_fingerprint = current`, clear `dismissed_until_fingerprint` if it now differs from `current`.
  5. If row exists and matches → no-op.
- [ ] **Dismissal filter** — `useAppStore` exposes a `visibleItems` selector that hides items whose `dismissed_until_fingerprint === current fingerprint`. All sections read from this filtered view (do not re-implement the filter per-section).
- [ ] **Row context menu** — `Mark read`, `Dismiss until it changes`, `Mute repo` (UI-only here; mute lands in #9). `Dismiss…` writes `dismissed_until_fingerprint = current fingerprint`. `Mark read` sets `unread = 0`.
- [ ] **Auto-mark-read on row open** — clicking a row in DetailPane sets `unread = 0` for that item.

## Files to add / modify

```
src-tauri/src/
├── poller/notifications.rs           ← new
├── poller/poll_loop.rs               ← fold notifications into pr.activity, then reconcileItemState
└── store/db.rs                       ← migration v6 (item_state)

src/
├── components/
│   ├── NeedsActionSection.tsx        ← new
│   ├── NeedsActionSection.test.tsx   ← new
│   ├── ActivityTab.tsx               ← new
│   ├── ActivityTab.test.tsx          ← new
│   ├── MainWindow/DetailPane.tsx     ← add Activity tab
│   ├── MainWindow/ListPane.tsx       ← prepend NeedsActionSection
│   ├── MainWindow/Sidebar.tsx        ← surface Needs Action count
│   └── RowContextMenu.tsx            ← new (mark read / dismiss / mute placeholder)
├── lib/
│   ├── storage/fingerprints.ts       ← new (pure)
│   ├── storage/fingerprints.test.ts  ← new
│   ├── storage/itemState.ts          ← new (SQL DAL)
│   ├── storage/itemState.test.ts     ← new
│   └── store.ts                      ← needsAction slice, visibleItems selector, dismiss/markRead actions
└── hooks/
    └── usePrComments.ts              ← new: detail-pane-only fallback fetch
```

## Test plan

**Unit (Vitest + MSW)**
- `fingerprints.test.ts` — six cases: identical inputs → identical output; lifecycle bump changes it; checks state flip changes it; new mention changes it; runs hash changes when an associated run conclusion flips; standalone run fingerprint stable on idle polls.
- `itemState.test.ts`:
  - New item → row inserted, `unread = 1`.
  - Same fingerprint → no row change.
  - Different fingerprint → `unread = 1`, fingerprint updated.
  - Dismissal: row marked dismissed at fingerprint X; next poll with X → still hidden; next poll with Y → reappears, dismissal cleared.
- `notifications` Rust unit test — fixture MSW response with one of each `reason`; assert routing matches the table above.
- `NeedsActionSection.test.tsx` — fixture store with all four inclusion-rule branches; verify inclusion + exclusion.
- `ActivityTab.test.tsx` — renders skeleton while loading, then merged comments + review replies; mention highlight on `@me`.

**Manual**
- Real PAT — `@`-mention yourself on a PR; within 60 s the PR appears in Needs Action Now with the mention badge; the tray badge increments.
- Reply to a review thread you started; PR appears under Needs Action Now with the reply badge.
- Right-click a row → Dismiss until it changes; row disappears. Trigger a new mention on the same PR; row reappears.
- Mark a row read manually; badge decrements; row stays visible but unread dot is cleared.

## Out of scope

| Concern | Lands in |
|---|---|
| OS notifications for mentions (the §10 "Comment / @mention" trigger) | #9 |
| Mute repo / Pin repo actually filtering data | #9 |
| Adaptive polling honoring `in_progress` items for fast cadence | #9 |
| Settings panel listing dismissal rules / mute rules | #9 |

## Notes

- **Notifications scope.** The PAT must include `notifications` scope (already listed in §4); #2's validate flow should already warn if missing. If a user installed Beet on an older PAT that lacks the scope, surface the warning in the Settings → PAT panel with a "Re-validate" CTA.
- **Reply-to-review heuristic.** `reason = "comment"` is broad on GitHub — it covers any comment on a thread you're subscribed to. The simplest robust signal: "the PR has at least one review-comment authored by me, and the latest review-comment is by someone else." Implement that in the notifications router; don't try to parse comment-body content.
- **Fingerprint stability vs noise.** The runs hash uses sha1 of a sorted, normalized run summary so cosmetic GitHub-side reordering doesn't cause false fingerprint changes. Keep the hash inputs minimal (id + status + conclusion) — do *not* include timestamps.
- **8a / 8b split.** If reviews push back on size: 8a ships notifications routing + `activity` counts + Needs Action Now section (no fingerprints, `unread` stays sticky from #5). 8b ships the `item_state` table + fingerprints + dismissal. Both halves are independently testable.
