# Sidebar Filters + Sidebar Hover Affordances

**Refs:** §5 (ActionableItem model) · §6 (scoring / team membership) · `design/src/main-window.jsx` (Filters group)

## Goal

The left sidebar's **Filters** group renders three items — **Failing only**, **Pending only**, **My team only** — that were hard-coded `disabled` placeholders with no state and no behavior. The list sections render every item the poller delivers, so there was no way to narrow the view to *what's broken*, *what's still running*, or *my teammates' PRs*.

Make the three filters functional, and give every clickable sidebar item a consistent hover affordance (previously only the pinned/muted rows reacted to hover, so the sidebar felt half-interactive).

## Filter behavior

Filters are **independent multi-select toggles**, **session-only** (reset on app restart, matching the `showAllReviewsOverride` precedent), applied to the live actionable sections — **Review Requests, In Flight, Standalone Runs** — and **never** to **Recently Resolved** (those are done; a check-status / team lens there is noise).

- **Failing only** — items with at least one failing check.
  - PR rows: `pr.checkRuns[].conclusion === "failure"` **or** `pr.associatedRuns[].conclusion === "failure"`.
  - Standalone runs: `run.conclusion === "failure"`.
- **Pending only** — items with at least one check still running/queued (no terminal conclusion yet).
  - PR rows: any `checkRun.status` of `queued`/`in_progress`, or any `associatedRun.status !== "completed"`.
  - Standalone runs: `run.status !== "completed"`.
- **My team only** — `pr.isAuthorOnMyTeam === true` (the +6 scoring signal). Standalone runs have no author/team, so they drop out when this is on.

### Combination rules

- **Failing** and **Pending** are the same axis (check status) → an item passes if `(failing && hasFailing) || (pending && hasPending)` ("failing OR still running").
- **My team** is an independent axis → AND-ed with the check axis.
- An item with no check data is hidden whenever a check filter is active.

### No-teams dead-end guard

`isAuthorOnMyTeam` is resolved by the Rust poller against `settings.teams`, which defaults to `[]` (configured at Settings → Account → "Teams to track"). With no teams set, every PR is `isAuthorOnMyTeam === false`, so "My team only" would silently hide everything. To avoid that dead-end:

- When `settings.teams.length === 0`, **My team only** renders `disabled` with a tooltip: *"Add teams in Settings → Account to use this filter"*, and can never become active.
- `passesListFilters` also treats `myTeamOnly` as inert when no teams are configured — a belt-and-suspenders so a stale session toggle can't strand the list.

### Interaction with existing state

- Sidebar badge counts read the same filtered hook, so they reflect the filtered view.
- `byId` stays unfiltered, so a currently-selected item still resolves in the detail pane even when a filter would hide its row.
- Mutes continue to apply everywhere; list filters are layered on top of mutes for the three live sections only.

## Hover affordances

- Every clickable `SidebarItem` (Triage nav + the three filters) lights up on hover using the same `--color-hover` token the pinned/muted `RemovableSidebarRow` already uses.
- Active items keep their `--color-accent-soft` fill; `disabled` items get no hover.

## UI details

- Filter icons use the app's `CheckDot` glyphs (`state="failure"` / `state="pending"`) and the `★` accent glyph for My team, matching `design/src/main-window.jsx`.
- Active filters reuse the existing `SidebarItem` active styling (`--color-accent-soft` + accent text, `aria-pressed`).
- A **Clear** action appears in the Filters group header only when at least one filter is active; it resets all three.
- When a section filters down to zero rows, its empty state shows filter-aware copy (e.g. "No review requests match the active filters.").

## Acceptance criteria

- [x] Each filter toggles independently (multi-select) and is session-only
- [x] Failing / Pending / My team apply to Review Requests, In Flight, Standalone Runs only — not Recently Resolved
- [x] Failing + Pending OR on the check axis; My team ANDs on top
- [x] Items with no check data are hidden under a check filter
- [x] My team only is disabled with an explanatory tooltip when no teams are configured, and the predicate ignores it in that state
- [x] Sidebar badge counts reflect the filtered view; selection/detail pane is unaffected
- [x] All clickable sidebar items have a hover background; active/disabled states are respected
- [x] Clear action appears only when a filter is active and resets all
- [x] Filter-aware empty-state copy in the three live sections
- [x] Unit tests for predicates + combination + no-teams guard, store tests for toggle/clear/reset, and Sidebar component tests; lint clean

## Files

```
src/lib/filters.ts                          ← new: ListFilters, predicates, applyListFilters
src/lib/filters.test.ts                     ← new: predicate + combination coverage
src/lib/store.ts                            ← session listFilters state + toggle/clear actions
src/hooks/useActionableItems.ts             ← apply filters to the three live sections
src/components/MainWindow/Sidebar.tsx       ← wire toggles, Clear action, My-team guard, hover
src/components/ReviewRequestsSection.tsx    ← filter-aware empty copy
src/components/InFlightSection.tsx          ← filter-aware empty copy
src/components/StandaloneRunsSection.tsx    ← filter-aware empty copy
issues/sidebar-filters.md                   ← this file
```
