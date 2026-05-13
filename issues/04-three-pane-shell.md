# #4 — Three-pane main-window shell

Replace the single-column flat list shipped in #3 with the **three-pane shell from [design/src/main-window.jsx](../design/src/main-window.jsx)**: sidebar (sections + filters + rate-limit card) | list (sections) | detail (selected item). This is a UI-only refactor — no new data sources, no new sections populated. Review Requests stays the only live section; In Flight, Standalone Runs, and Recently Resolved render as empty section headers with "lands in #N" hints (same convention #3 established).

Refs: [SPECS.md §11](../SPECS.md) (main window: three-pane), [design/src/main-window.jsx](../design/src/main-window.jsx), [design/src/ui.jsx](../design/src/ui.jsx). Builds on [#3](03-review-requests-scoring.md). Unblocks [#5](05-my-prs-in-flight.md) (In Flight section slots into the existing `ListPane`).

## Why split this from #5

The original #4 bundled the shell refactor with the In Flight (Yours) data query and lifecycle history. Shipping the shell on its own buys two things: (1) the design comes online sooner — the next launch after #3 already looks like the mockup; (2) #5's review surface stays focused on data correctness (lifecycle derivation, ejection detection, cache sharing) rather than mixing pixel-match feedback with query semantics.

Ship-criterion: opening the main window after #4 looks like [design/src/main-window.jsx](../design/src/main-window.jsx) with Review Requests populated and the other three middle-pane sections rendering empty headers. No new GitHub queries, no SQLite migrations.

## Goal

Opening the main window shows the design's three-pane layout:
- **Sidebar** — Triage sections (live counts from the existing `actionableItems` map), Filters (inert), Pinned/Muted (empty placeholders), Rate-limit card.
- **List pane** — `ReviewRequestsSection` from #3, plus empty section headers for In Flight / Standalone Runs / Recently Resolved.
- **Detail pane** — right column shows the selected item's header (repo/num, title, score, Open on GitHub); "Select an item." default state when nothing is selected.

Clicking a row selects it (does not open the browser); the row's chrome highlights and the detail pane updates.

## Acceptance criteria

- [ ] **Layout** — `src/app/page.tsx` renders the `MainWindowShell` per [design/src/main-window.jsx:16-32](../design/src/main-window.jsx): `gridTemplateColumns: "200px 1fr 380px"` with `TitleBar` on top. Pixel-match the design's spacing, borders, and color tokens.
- [ ] **`TitleBar`** — BeetMark + "Beet" label + search-input placeholder (non-functional in #4; real ⌘K lookup is later) + `PollingDot` + refresh/pause/settings icon buttons. Refresh button triggers `queryClient.invalidateQueries` on the actionable-items queries.
- [ ] **`Sidebar`** — `SidebarGroup`s for **Triage**, **Filters**, **Pinned**, **Muted** per the design.
  - Triage items show live counts from the Zustand `actionableItems` map: Review Requests (`kind === "pr" && pr.isReviewRequestedFromMe`), In Flight (0 until #5), Standalone Runs (0 until #6), Recently Resolved (0 until #6).
  - Filters render but are inert (interactivity ships in #8).
  - Pinned and Muted render the headers + an "empty" line; real data lands in #9.
  - Rate-limit card (bottom) reads from `useAppStore(s => s.rateLimit)` and matches the design's compact gauge + reset countdown.
- [ ] **`ListPane`** — middle column hosts the existing `ReviewRequestsSection` plus empty section headers for **In Flight**, **Standalone Runs**, and **Recently Resolved**. Sections render even with zero items (the design's `ListGroup` returns `null` for empty lists, but our equivalent shows the section header + empty-state hint — same rule #3 established). The deferred-sections hint from #3 is removed; it's replaced by these real (empty) section headers, each annotated with "lands in #N" so manual QA can tell the difference between data-empty and not-yet-built.
- [ ] **`DetailPane`** — right column, 380 px. When nothing is selected, shows "Select an item." When a `kind === "pr"` item is selected, renders the design's header block: repo/num/branch (branch placeholder — fetched in #5), title, ScoreBar (width 36), Open-on-GitHub button. The Lifecycle pill slot is rendered but shows `open` for everything (full enum lands in #5). The "Body / Reviewers / Checks / Activity" blocks from the design render as section headers with "lands in #6 / #8" placeholders so the visual structure exists without faking data.
- [ ] **Selection state** — `useAppStore` gains `selectedItemId: string | null` + `setSelectedItemId`. `ActionableRow` accepts an `active` prop and renders the design's active treatment (left-edge 2 px accent border, accent-soft background per [design/src/main-window.jsx:213-216](../design/src/main-window.jsx)). Clicking a row sets selection rather than opening the browser; an explicit "Open on GitHub" button in the detail rail (or ⌘-click on the row) is the open path. Reasoning: the design treats rows as triage targets, not link launchers.
- [ ] **Auto-select** — `MainWindowShell` reads `selectedItemId` and falls back to "first item in Review Requests" if `null`, matching the design's auto-select behavior.
- [ ] **`PollingDot`** component — port from [design/src/ui.jsx](../design/src/ui.jsx). Reads polling state from the existing TanStack Query status; renders the design's three states (idle / polling / error).
- [ ] **No regression to Settings or Banner** — the missing-token banner still renders above the shell when `bannerReason !== null`; opening Settings still swaps the surface.

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
│   │   ├── ListPane.tsx                    ← hosts ReviewRequestsSection + empty placeholders
│   │   └── DetailPane.tsx
│   └── PollingDot.tsx                      ← port design/src/ui.jsx PollingDot
└── lib/
    └── store.ts                            ← +selectedItemId, +setSelectedItemId

src/components/MainWindow/MainWindowShell.test.tsx  ← shell layout + selection
src/components/MainWindow/Sidebar.test.tsx          ← live counts + rate-limit
src/components/MainWindow/DetailPane.test.tsx       ← empty state + selected-PR header
```

## Dependencies to add

None — same toolchain as #3.

## Selection model

```ts
// src/lib/store.ts (extend)
selectedItemId: string | null;
setSelectedItemId(id: string | null): void;
```

`ActionableRow` becomes a selection control rather than a link; the click handler now calls `setSelectedItemId(item.id)`. The "Open on GitHub" affordance moves to the `DetailPane` header (button) and to the tray (#7).

## Test plan

**Unit (Vitest + RTL)**

- `MainWindowShell.test.tsx` — click row → `selectedItemId` updates → detail pane re-renders with that PR's header; "Select an item." default state when nothing selected; auto-select picks the first Review Requests row when `selectedItemId` is null.
- `Sidebar.test.tsx` — Triage counts derived from the `actionableItems` map (Review Requests live, others render `0`); rate-limit card reflects `useAppStore.rateLimit`; Filters/Pinned/Muted groups render but rows are inert.
- `DetailPane.test.tsx` — empty state when no selection; selected-PR header shows title + repo/num + ScoreBar + Open-on-GitHub; placeholder section headers for Body/Reviewers/Checks/Activity present.

**Manual**

- Open with a real PAT — Review Requests populates in the middle pane, the other three section headers render empty with "lands in #N" hints, sidebar counts match.
- Click a row in Review Requests — row highlights, detail pane shows the PR header, "Open on GitHub" button opens the PR in the browser. Click a different row — selection moves.
- Refresh button in the TitleBar invalidates queries — the Review Requests list refetches.
- Rate-limit card in the sidebar updates after the first successful poll.
- Resize the window — middle pane flexes, sidebar (200 px) and detail pane (380 px) hold their widths per the design's `gridTemplateColumns`.
- Pixel-compare against `./design/serve.sh` rendering of [design/src/main-window.jsx](../design/src/main-window.jsx).

## Out of scope (deferred)

| Concern | Lands in |
|---|---|
| In Flight (Yours) section populated | #5 |
| Lifecycle pill full enum + `pr_lifecycle_history` | #5 |
| Merge-queue ejection detection | #5 |
| Workflow runs + Recently Resolved + Standalone Runs sections | #6 |
| Detail pane: real Body / Reviewers / Checks / Activity | #6 (checks/runs) + #8 (mentions) |
| Tray popover surface | #7 |
| Window-close-≠-quit, refresh-from-tray | #7 |
| Sidebar filters become interactive (failing-only, pending-only, my-team-only) | #8 |
| Fingerprints + real `unread` + snooze | #8 |
| Pinned / Muted real data + sidebar rules | #9 |
| ⌘K search (TitleBar input is a non-functional placeholder in #4) | post-V1 |

## Notes

- **Don't fake the detail pane.** Empty section headers ("Reviewers — lands in #6", etc.) are fine and follow the same rule #3 set for the list. *Stubbed* reviewer rows or fabricated check states are not — they'll mislead during manual QA.
- **Pixel match.** Use the design's exact `gridTemplateColumns` (`200px 1fr 380px`), section header typography (`fontSize: 11, uppercase, letterSpacing: 0.06`), and row padding (`var(--row-pad-y)`). The `--color-*` tokens added in #3 cover everything the design's `--bg / --panel / --border / --accent` references.
- **Selection persistence.** Store `selectedItemId` in memory only — don't write it to SQLite. Restoring last-selection across launches is nice-to-have, not a #4 requirement.
- **Lifecycle pill placeholder.** The slot is rendered in the detail pane so #5 can drop in the full enum without further layout work, but in #4 every PR shows `open`. This is a deliberate stub, not faked data — the pill reflects the only lifecycle value derivable from the current data layer.
