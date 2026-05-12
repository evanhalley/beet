# #4 — My PRs + In Flight + 3-column main-window shell

Bring the second `ActionableItem` query online — `author:@me` open PRs — and replace the flat list with the **three-pane shell from [design/src/main-window.jsx](../design/src/main-window.jsx)**: sidebar (sections + filters + rate-limit card) | list (sections) | detail (selected item). Add the `Lifecycle` pill (`open` / `in_review` / `merge_queue · pos N` / `merged` / `closed`), persist lifecycle transitions to SQLite, and detect merge-queue ejections (unread bump only — OS notifications land in #8).

Refs: [SPECS.md §5](../SPECS.md) (`PrLifecycle` enum, full `pr.*` shape), [§7](../SPECS.md) (My open PRs query + merge-queue ejection detection), [§9](../SPECS.md) (`pr_lifecycle_history` table), [§11](../SPECS.md) (main window: three-pane). Builds on [#3](03-review-requests-scoring.md).

## Why this issue covers the 3-pane shell

#3 shipped the Review Requests section but in a single-column layout — a known deviation from [design/src/main-window.jsx](../design/src/main-window.jsx), called out in the #3 PR description. #4 is the natural place to land the shell because **In Flight (Yours)** gives the middle column a second section to compete with, **Lifecycle** gives the detail rail something substantive to render, and the sidebar's per-section count badges suddenly mean something.

## Goal

Opening the main window shows the design's three-pane layout: sidebar with Triage sections (live counts), Pinned/Muted (empty placeholders until #8), and the Rate-limit card; middle pane with Review Requests + In Flight sections; right pane shows the selected item's header (title, repo/num, Lifecycle pill, score, Open on GitHub). Clicking a row selects it; the row's chrome highlights and the detail pane updates.

## Acceptance criteria

### Three-pane shell

- [ ] **Layout** — `src/app/page.tsx` renders the `MainWindowShell` per [design/src/main-window.jsx:16-32](../design/src/main-window.jsx): `gridTemplateColumns: "200px 1fr 380px"` with `TitleBar` on top. Pixel-match the design's spacing, borders, and color tokens.
- [ ] **`TitleBar`** — BeetMark + "Beet" label + search-input placeholder (non-functional in #4; real ⌘K lookup is later) + `PollingDot` + refresh/pause/settings icon buttons. Refresh button triggers `queryClient.invalidateQueries` on the actionable-items queries.
- [ ] **`Sidebar`** — `SidebarGroup`s for **Triage**, **Filters**, **Pinned**, **Muted** per the design.
  - Triage items show live counts from the Zustand `actionableItems` map: Review Requests (`kind === "pr" && pr.isReviewRequestedFromMe`), In Flight (`kind === "pr" && pr.isAuthoredByMe`), Standalone Runs (0 until #5), Recently Resolved (0 until #5).
  - Filters render but are inert in #4 (interactivity ships later).
  - Pinned and Muted render the headers + an "empty" line; real data lands in #8.
  - Rate-limit card (bottom) reads from `useAppStore(s => s.rateLimit)` and matches the design's compact gauge + reset countdown.
- [ ] **`ListPane`** — middle column hosts the existing `ReviewRequestsSection` plus the new `InFlightSection`. Sections render even with zero items (the design's `ListGroup` returns `null` for empty lists, but our equivalent should show the section header + empty-state hint so the user can tell the data is real-but-empty vs. unwritten — the same rule #3 established). The deferred-sections hint from #3 is removed; it's replaced by the real (empty) section headers as they come online in #5 and #7.
- [ ] **`DetailPane`** — right column, 380 px. When nothing is selected, shows "Select an item." When a `kind === "pr"` item is selected, renders the design's header block: repo/num/branch (branch placeholder until we fetch it), title, Lifecycle pill, ScoreBar (width 36), Open-on-GitHub button. The "Body / Reviewers / Checks / Activity" blocks from the design render as section headers with "lands in #5 / #7" placeholders so the visual structure exists without faking data.
- [ ] **Selection state** — `useAppStore` gains `selectedItemId: string | null` + `setSelectedItemId`. `ActionableRow` accepts an `active` prop and renders the design's active treatment (left-edge 2 px accent border, accent-soft background per [design/src/main-window.jsx:213-216](../design/src/main-window.jsx)). Clicking a row sets selection rather than opening the browser; an explicit "Open on GitHub" button in the detail rail (or ⌘-click on the row) is the open path. Reasoning: the design treats rows as triage targets, not link launchers.
- [ ] **No regression to Settings or Banner** — the missing-token banner still renders above the shell when `bannerReason !== null`; opening Settings still swaps the surface.

### In Flight (Yours)

- [ ] **`fetchMyOpenPrs`** in `src/lib/github/prs.ts` — search query `is:pr is:open author:${username}`, same per-PR detail fan-out as `fetchReviewRequests`, returns `ActionableItem[]` with `pr.isAuthoredByMe = true`. ETag cache key: `search:author:@me`. Per-PR detail cache keys reuse the existing scheme so Review Requests and In Flight share cache rows when a PR shows up in both.
- [ ] **`useMyOpenPrs`** hook — TanStack Query, same `pollingIntervalSec` from settings, syncs into the same `actionableItems` map (merge by id rather than replace, so the Review Requests sync from #3 doesn't blow them away and vice versa).
- [ ] **`InFlightSection`** component — same `ActionableRow` primitive, `variant="inflight"`, sorted by `updatedAt desc` (not by score — score only applies to review requests per §6). Row anatomy matches the design's `type="inflight"` branch: Lifecycle pill instead of team/draft pills, no `ScoreBar` (score column hides for non-review rows).
- [ ] **Section ordering in the middle pane** — Review Requests first, then In Flight, matching the design's `ListGroup` ordering.

### Lifecycle + ejection detection

- [ ] **`PrLifecycle` is fully derived in `prs.ts`.** From `pulls.get`:
  - `state: "closed"` and `merged: true` → `"merged"`
  - `state: "closed"` and `merged: false` → `"closed"`
  - `auto_merge != null` *or* `mergeable_state === "blocked" && in merge queue` → `"merge_queue"` (the exact signal is documented in §7; reuse PRZ's read if simpler)
  - `requested_reviewers.length > 0` → `"in_review"`
  - else → `"open"`
- [ ] **`Lifecycle` component** (port from [design/src/ui.jsx:158-164](../design/src/ui.jsx)) — `state="merge_queue"` renders `queue · {pos ?? "?"}` mono accent pill; other states map to info / neutral / accent / neutral pills. The `mqPos` field on `pr.mergeQueue` isn't fully wired in #4 — render `"?"` if absent.
- [ ] **`pr_lifecycle_history` table** added via a new SQLite migration:
  ```sql
  CREATE TABLE pr_lifecycle_history (
    pr_id TEXT NOT NULL,
    lifecycle TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    PRIMARY KEY (pr_id, observed_at)
  );
  ```
- [ ] **`recordLifecycle(prId, lifecycle)`** in `src/lib/storage/lifecycle.ts`. Called from `fetchMyOpenPrs` for every PR returned; only inserts when the new lifecycle differs from the most-recent row for that pr_id (avoid bloating the table on no-op polls).
- [ ] **Ejection detection.** `detectEjection(prId, nextLifecycle)` reads the most-recent prior row. If `prev === "merge_queue"` and `next !== "merge_queue"` and `next !== "merged"`, mark the item's `unread = true` (placeholder for the eventual fingerprint-driven unread system in #7) and tag the item with `pr.mergeQueue.lastEjectionAt = now`. OS notification does **not** fire here — it lands in #8.

## Files to add

```
src/
├── app/
│   └── page.tsx                            ← swap flat layout for <MainWindowShell/>
├── components/
│   ├── MainWindow/
│   │   ├── MainWindowShell.tsx
│   │   ├── TitleBar.tsx
│   │   ├── Sidebar.tsx                     ← Triage/Filters/Pinned/Muted/RateLimitCard
│   │   ├── ListPane.tsx                    ← hosts Review + InFlight sections
│   │   └── DetailPane.tsx
│   ├── InFlightSection.tsx
│   ├── Lifecycle.tsx                       ← port design/src/ui.jsx Lifecycle
│   └── PollingDot.tsx                      ← port design/src/ui.jsx PollingDot
├── hooks/
│   └── useMyOpenPrs.ts
├── lib/
│   ├── github/
│   │   └── prs.ts                          ← +fetchMyOpenPrs, +deriveLifecycle
│   └── storage/
│       ├── lifecycle.ts                    ← recordLifecycle, detectEjection
│       └── migrations.ts                   ← +pr_lifecycle_history table
└── test/
    └── fixtures/
        ├── search-author-me.json
        ├── pulls-get-acme-api-412-{open,in-review,queue,merged}.json   ← lifecycle progression
        └── ...

src/lib/github/prs.test.ts                  ← extended: fetchMyOpenPrs + lifecycle derivation
src/lib/storage/lifecycle.test.ts           ← new
src/hooks/useMyOpenPrs.test.tsx             ← new
src/components/InFlightSection.test.tsx     ← new
src/components/MainWindow/MainWindowShell.test.tsx  ← shell layout + selection
src/components/MainWindow/Sidebar.test.tsx          ← live counts + rate-limit
```

## Dependencies to add

None — same toolchain as #3.

## `ActionableItem` shape (additions filled in this issue)

```ts
pr: {
  // ...everything from #3 plus:
  lifecycle: PrLifecycle;            // full enum, not just open|in_review
  mergeQueue?: {
    position: number | null;
    enteredAt: string;
    lastEjectionAt?: string;
  };
  isAuthoredByMe: true;               // for In Flight rows
}
```

## Selection model

```ts
// src/lib/store.ts (extend)
selectedItemId: string | null;
setSelectedItemId(id: string | null): void;
```

`MainWindowShell` reads `selectedItemId` and falls back to "first item in Review Requests, then first item in In Flight" if `null`, matching the design's auto-select. `ActionableRow` becomes a selection control rather than a link; the click handler now calls `setSelectedItemId(item.id)`. The "Open on GitHub" affordance moves to the `DetailPane` header (button) and to the tray (#6).

## Test plan

**Unit (Vitest + MSW)**

- `prs.test.ts`:
  - `fetchMyOpenPrs` returns scored-but-unsorted-by-score items (`updatedAt desc`), with `isAuthoredByMe = true`.
  - Lifecycle derivation table: 6 cases (`open` → `in_review` → `merge_queue` → `merged`; plus `closed` and back-out-of-queue).
- `lifecycle.test.ts`:
  - `recordLifecycle` writes a row when the latest differs; no-op when it matches.
  - `detectEjection` returns `true` only on `merge_queue → !merged && !merge_queue`.
- `useMyOpenPrs.test.tsx` — merge-into-`actionableItems` semantics: existing review-request rows survive a my-prs refetch and vice versa.
- `Sidebar.test.tsx` — Triage counts derived from the `actionableItems` map; rate-limit card reflects `useAppStore.rateLimit`.
- `MainWindowShell.test.tsx` — click row → selection updates → detail pane re-renders; "Select an item." default state when nothing selected.
- `InFlightSection.test.tsx` — sort by `updatedAt`, Lifecycle pill present, no ScoreBar.

**Manual**

- Open with a real PAT — Review Requests and In Flight both populate; sidebar counts match.
- Select a PR in In Flight — detail pane shows the lifecycle pill, Open on GitHub button works.
- Force a PR through the merge queue (or use a fixture). The lifecycle history row appears; ejecting it (queue → open) marks the row unread and updates `lastEjectionAt`.
- Refresh button in the TitleBar invalidates queries — both lists refetch.
- Rate-limit card in the sidebar updates after the first successful poll.

## Out of scope (deferred)

| Concern | Lands in |
|---|---|
| Workflow runs + Recently Resolved section | #5 |
| Standalone Runs section | #5 |
| Detail pane: real Body / Reviewers / Checks / Activity | #5 (checks/runs) + #7 (mentions) |
| Tray popover surface | #6 |
| Window-close-≠-quit, refresh-from-tray | #6 |
| Sidebar filters become interactive (failing-only, pending-only, my-team-only) | #7 |
| Fingerprints + real `unread` + snooze | #7 |
| OS notification for merge-queue ejection | #8 |
| Pinned / Muted real data + sidebar rules | #8 |
| Adaptive polling responding to `mergeQueue` lifecycle (fast cadence for in-flight) | #8 |

## Notes

- **Per-PR cache sharing.** A PR that's both authored by me *and* requested-reviewer-from-me (rare but possible) should hit the same `pr:{owner}/{repo}#{n}:detail` cache rows regardless of which query saw it first. Same cache keys from #3 — don't introduce new ones keyed by section.
- **Sort discipline.** Score is meaningful only for review requests. In Flight rows sort by `updatedAt desc` — don't accidentally pipe them through `scorePullRequests` and re-sort by score, or you'll demote your own queue-stuck PR below an old draft.
- **Don't fake the detail pane.** Empty section headers ("Reviewers — lands in #5", etc.) are fine and follow the same rule #3 set for the list. *Stubbed* reviewer rows or fabricated check states are not — they'll mislead during manual QA.
- **`mergeQueue.position`.** GitHub's merge-queue position isn't directly on `pulls.get`. Leave `position = null` and render `"?"` in the Lifecycle pill until #5 (when workflow runs give us `merge_group` ref data) or whenever we wire `repos.getCombinedStatusForRef`. This is a known TODO; document it in the PR.
- **Selection persistence.** Store `selectedItemId` in memory only for V1 — don't write it to SQLite. Restoring last-selection across launches is nice-to-have, not a #4 requirement.
- **Pixel match.** Use the design's exact `gridTemplateColumns` (`200px 1fr 380px`), section header typography (`fontSize: 11, uppercase, letterSpacing: 0.06`), and row padding (`var(--row-pad-y)`). The `--color-*` tokens added in #3 cover everything the design's `--bg / --panel / --border / --accent` references.
