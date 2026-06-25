# #6 — Workflow runs + collapse + Recently Resolved

Port Action Jackson's workflow-run fetching into Beet, apply the SPECS §7 collapse-into-PR rule, and turn on the two stub sections in the middle pane: **Standalone Runs** and **Recently Resolved**.

This unblocks #8 (mentions / Needs Action Now) and #9 (OS notifications), both of which assume the full `ActionableItem` corpus.

## Scope

### Data layer (Rust poller)

- **NEW** `src-tauri/src/poller/runs.rs` — port `fetchRunsForRepo` / `fetchAllRuns` from github.ts. Use the existing octocrab client + ETag cache. Call `actions.listWorkflowRunsForRepo` with `actor={me}`, `per_page=30`, across the user's tracked repos (same repo list the PR poller builds).
- **Collapse logic** — for each run, inspect `pull_requests[]`. If any PR id matches an item currently in `reviewRequests` ∪ `inFlight`, attach an `AssociatedRun` (most recent per workflow name) to that PR's `associated_runs` and drop the run from the standalone list. Otherwise emit it as a standalone `ActionableItem { kind: Run, run: Some(...), pr: None }`. Push-event runs without a PR are surfaced — branch filtering is *not* used (per SPECS §7).
- **Schema migration v5** — `src-tauri/src/store/db.rs`: add
  ```sql
  CREATE TABLE run_completion_events (
    run_id INTEGER PRIMARY KEY,
    repo TEXT NOT NULL,
    workflow_name TEXT NOT NULL,
    conclusion TEXT,
    concluded_at TEXT NOT NULL,
    pr_number INTEGER
  );
  ```
  Used to (a) survive restarts for the Recently Resolved 24h window and (b) dedupe the "run finished" notification that lands in #9.
- **Types** — extend `src-tauri/src/poller/types.rs` and mirror in `src/lib/types.ts`:
  - `ActionableItemRun { workflow_name, branch, sha, status, conclusion, run_url, started_at, completed_at }`
  - `AssociatedRun` (subset, one per workflow name)
  - `ActionableItem.run: Option<ActionableItemRun>`
  - `ActionableItemPr.associated_runs: Vec<AssociatedRun>`
- **Payload** — `PollResultPayload` gains `standalone_runs: Vec<ActionableItem>` and `recently_resolved: Vec<ActionableItem>`. Populate in `poll_loop.rs` after the existing PR pass so collapse sees the PR set.

### Recently Resolved

Collected from two streams, sorted by resolution time desc, capped at ~50 items:

1. PRs whose lifecycle transitioned to `merged` or `closed` within the last 24h (read from `pr_lifecycle_history`).
2. Runs with `status=completed` and `completed_at` within the last 24h that are not attached to a still-open tracked PR.

### Frontend

- `src/lib/store.ts` — add `standaloneRuns: ActionableItem[]` and `recentlyResolved: ActionableItem[]`; index into `byId`.
- **NEW** `src/components/StandaloneRunsSection.tsx` — modeled on [src/components/ReviewRequestsSection.tsx](src/components/ReviewRequestsSection.tsx). Collapsible header, `ActionableRow` per item.
- **NEW** `src/components/RecentlyResolvedSection.tsx` — collapsed by default. Shows merged PRs + completed runs in the last 24h.
- `src/components/MainWindow/ListPane.tsx` — replace the two `EmptySection` stubs with the real components.
- `src/components/MainWindow/DetailPane.tsx` — extend the Checks block to render `pr.associatedRuns` (per-workflow latest run with status + duration), in addition to existing `pr.checkRuns`.
- `src/components/SearchPalette.tsx` (⌘K) — verify it reads sections generically so the new corpus is searchable automatically.

### Tests

- `src/lib/github/runs.test.ts` (or Rust equivalent) — MSW fixtures for `listWorkflowRunsForRepo`. Cover: run with tracked PR → attached, not standalone; orphan run → standalone; push-event run without PR → standalone.
- `src/components/StandaloneRunsSection.test.tsx` / `RecentlyResolvedSection.test.tsx` — render against fixture store state; verify empty state, 24h cutoff.
- Rust unit test on the collapse function in `runs.rs`.

## Reuse

- Lift `fetchRunsForRepo` / `fetchAllRuns` signatures verbatim from github.ts (per SPECS §14).
- `RunStatus` / `StatusBadge` from components.
- Existing ETag cache (`etag_cache` table) — no schema change needed for caching, only for completion history.
- Existing `ActionableRow` already switches on `kind` and can render run rows.

## Acceptance

1. `npm run tauri dev` against a real PAT — Standalone Runs section populates from a repo with `workflow_dispatch` runs you triggered.
2. A workflow run on a tracked PR appears under that PR's Checks block in DetailPane and is **not** duplicated in Standalone Runs.
3. Merging or closing a PR makes it appear in Recently Resolved within one poll cycle and drop off after 24h.
4. ⌘K palette finds standalone runs and resolved items by title / repo / workflow name.
5. `npx vitest` and `cargo test` (in `src-tauri/`) green. Lint/format clean.
