# #5 — My PRs + In Flight + lifecycle history

Bring the second `ActionableItem` query online — `author:@me` open PRs — and populate the **In Flight (Yours)** section in the middle pane of the shell shipped in [#4](04-three-pane-shell.md). Add the full `Lifecycle` pill (`open` / `in_review` / `merge_queue · pos N` / `merged` / `closed`), persist lifecycle transitions to SQLite, and detect merge-queue ejections (unread bump only — OS notifications land in #9).

Refs: [SPECS.md §5](../SPECS.md) (`PrLifecycle` enum, full `pr.*` shape), [§7](../SPECS.md) (My open PRs query + merge-queue ejection detection), [§9](../SPECS.md) (`pr_lifecycle_history` table). Builds on [#4](04-three-pane-shell.md).

## Goal

The In Flight (Yours) section in the existing `ListPane` populates with `author:@me` PRs. Each row renders the design's `type="inflight"` anatomy: Lifecycle pill, no ScoreBar, sorted by `updatedAt desc`. The detail pane's Lifecycle slot (placeholder in #4) now reflects the full enum. Lifecycle transitions persist to SQLite, and queue ejections flip `unread` on the affected row.

## Acceptance criteria

### In Flight (Yours)

- [ ] **`fetchMyOpenPrs`** in `src/lib/github/prs.ts` — search query `is:pr is:open author:${username}`, same per-PR detail fan-out as `fetchReviewRequests`, returns `ActionableItem[]` with `pr.isAuthoredByMe = true`. ETag cache key: `search:author:@me`. Per-PR detail cache keys reuse the existing scheme so Review Requests and In Flight share cache rows when a PR shows up in both.
- [ ] **`useMyOpenPrs`** hook — TanStack Query, same `pollingIntervalSec` from settings, syncs into the same `actionableItems` map (merge by id rather than replace, so the Review Requests sync from #3 doesn't blow them away and vice versa).
- [ ] **`InFlightSection`** component — same `ActionableRow` primitive, `variant="inflight"`, sorted by `updatedAt desc` (not by score — score only applies to review requests per §6). Row anatomy matches the design's `type="inflight"` branch: Lifecycle pill instead of team/draft pills, no `ScoreBar` (score column hides for non-review rows).
- [ ] **Section ordering in the middle pane** — Review Requests first, then In Flight, matching the design's `ListGroup` ordering. The empty "In Flight" header rendered in #4 is replaced with the real, populated section.
- [ ] **Sidebar count** — Triage > In Flight count goes live (was `0` in #4), driven by the same `actionableItems` map filter.

### Lifecycle + ejection detection

- [ ] **`PrLifecycle` is fully derived in `prs.ts`.** From `pulls.get`:
  - `state: "closed"` and `merged: true` → `"merged"`
  - `state: "closed"` and `merged: false` → `"closed"`
  - `auto_merge != null` *or* `mergeable_state === "blocked" && in merge queue` → `"merge_queue"` (the exact signal is documented in §7; reuse PRZ's read if simpler)
  - `requested_reviewers.length > 0` → `"in_review"`
  - else → `"open"`
- [ ] **`Lifecycle` component** (port from [design/src/ui.jsx:158-164](../design/src/ui.jsx)) — `state="merge_queue"` renders `queue · {pos ?? "?"}` mono accent pill; other states map to info / neutral / accent / neutral pills. The `mqPos` field on `pr.mergeQueue` isn't fully wired in #5 — render `"?"` if absent.
- [ ] **Detail pane Lifecycle slot** — the placeholder pill from #4 (always `open`) now uses the real `Lifecycle` component and reflects the full enum.
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
- [ ] **Ejection detection.** `detectEjection(prId, nextLifecycle)` reads the most-recent prior row. If `prev === "merge_queue"` and `next !== "merge_queue"` and `next !== "merged"`, mark the item's `unread = true` (placeholder for the eventual fingerprint-driven unread system in #8) and tag the item with `pr.mergeQueue.lastEjectionAt = now`. OS notification does **not** fire here — it lands in #9.

## Files to add

```
src/
├── components/
│   ├── InFlightSection.tsx
│   └── Lifecycle.tsx                       ← port design/src/ui.jsx Lifecycle
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
```

## Dependencies to add

None — same toolchain as #4.

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

## Test plan

**Unit (Vitest + MSW)**

- `prs.test.ts`:
  - `fetchMyOpenPrs` returns scored-but-unsorted-by-score items (`updatedAt desc`), with `isAuthoredByMe = true`.
  - Lifecycle derivation table: 6 cases (`open` → `in_review` → `merge_queue` → `merged`; plus `closed` and back-out-of-queue).
- `lifecycle.test.ts`:
  - `recordLifecycle` writes a row when the latest differs; no-op when it matches.
  - `detectEjection` returns `true` only on `merge_queue → !merged && !merge_queue`.
- `useMyOpenPrs.test.tsx` — merge-into-`actionableItems` semantics: existing review-request rows survive a my-prs refetch and vice versa.
- `InFlightSection.test.tsx` — sort by `updatedAt`, Lifecycle pill present, no ScoreBar.

**Manual**

- Open with a real PAT — Review Requests and In Flight both populate; sidebar counts match.
- Select a PR in In Flight — detail pane shows the lifecycle pill, Open on GitHub button works.
- Force a PR through the merge queue (or use a fixture). The lifecycle history row appears; ejecting it (queue → open) marks the row unread and updates `lastEjectionAt`.
- Refresh button in the TitleBar invalidates queries — both lists refetch.

## Out of scope (deferred)

| Concern | Lands in |
|---|---|
| Workflow runs + Recently Resolved section | #6 |
| Standalone Runs section | #6 |
| Detail pane: real Body / Reviewers / Checks / Activity | #6 (checks/runs) + #8 (mentions) |
| Tray popover surface | #7 |
| Window-close-≠-quit, refresh-from-tray | #7 |
| Sidebar filters become interactive (failing-only, pending-only, my-team-only) | #8 |
| Fingerprints + real `unread` + snooze | #8 |
| OS notification for merge-queue ejection | #9 |
| Pinned / Muted real data + sidebar rules | #9 |
| Adaptive polling responding to `mergeQueue` lifecycle (fast cadence for in-flight) | #9 |

## Notes

- **Per-PR cache sharing.** A PR that's both authored by me *and* requested-reviewer-from-me (rare but possible) should hit the same `pr:{owner}/{repo}#{n}:detail` cache rows regardless of which query saw it first. Same cache keys from #3 — don't introduce new ones keyed by section.
- **Sort discipline.** Score is meaningful only for review requests. In Flight rows sort by `updatedAt desc` — don't accidentally pipe them through `scorePullRequests` and re-sort by score, or you'll demote your own queue-stuck PR below an old draft.
- **`mergeQueue.position`.** GitHub's merge-queue position isn't directly on `pulls.get`. Leave `position = null` and render `"?"` in the Lifecycle pill until #6 (when workflow runs give us `merge_group` ref data) or whenever we wire `repos.getCombinedStatusForRef`. This is a known TODO; document it in the PR.
