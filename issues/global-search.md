# Global search (⌘K palette)

Wire up the ⌘K jumper the design has been mocking since #4. The TitleBar already renders a non-interactive "Search PRs, runs, repos…" pill ([src/components/MainWindow/TitleBar.tsx:62-83](../src/components/MainWindow/TitleBar.tsx#L62-L83)); make it real. A modal palette opens on click or ⌘K, filters every `ActionableItem` currently in `useAppStore` against a tiny client-side matcher, and selecting a result drives the existing selection model in the three-pane shell.

Refs: [SPECS.md §11](../SPECS.md) (Main window surface), design's TitleBar pill in [design/src/main-window.jsx:80](../design/src/main-window.jsx#L80).

Off-plan — not in the 10-step V1 build; sits alongside the build plan and can ship whenever.

## Goal

A user pressing ⌘K (or clicking the search pill) gets a fast, in-memory jump-to surface. Typing a fragment of a title, repo slug, PR number, author handle, or task chip filters the loaded items in real time; Enter selects the top match and the detail pane updates. Esc closes without changing selection.

## Non-goals (V1 of this feature)

- **Not** a GitHub API search. The corpus is what's already in `useAppStore` — no extra network. The user has github.com's omnibar for global GitHub search; Beet's value is helping you find a known item *you've already been notified about*.
- **Not** a command palette. This is search-over-items, not actions ("toggle theme", "refresh"). Action palettes are a separate feature.
- **No** persisted history, recent-searches dropdown, or filter-chip DSL (`repo:`, `is:open`). Substring matching on the haystack covers these well enough at the current data size.

## Acceptance criteria

### Matcher

- [ ] **`src/lib/search/index.ts`** exports `matchItems(query: string, items: ActionableItem[]): ActionableItem[]` — a pure function returning the filtered + ranked list. No React, no store access.
- [ ] **Haystack per item** built from `pr.title`, `pr.repo`, `#${pr.number}` (with and without the `#`), `pr.author.login`, and `pr.tasks.map(t => t.id).join(" ")`.
- [ ] **Two-pass matching**: substring first (case-insensitive), then word-initials fallback (`arc` matches "**A**dd **R**ate-limit **C**ache"). Substring hits always outrank initials hits.
- [ ] **Ranking**: lower hit-position wins; ties broken by `updatedAt desc`.
- [ ] **Empty query** returns `[]` (the palette renders its empty state, not "all items").
- [ ] **No fuzzy-match dependency** — keep the matcher in-tree.

### Palette UI

- [ ] **`src/components/SearchPalette.tsx`** — modal overlay with semi-transparent backdrop and a centered card (max-width 560px, max-height 60vh). Built on `--color-panel`, `--color-border`, `--color-accent-soft` so it honours theme + accent.
- [ ] **Input at the top**, autofocuses on open. Placeholder mirrors the pill: "Search PRs, runs, repos…".
- [ ] **Results list** below the input. Each row renders `repo · #num · title · author`. Hovered/selected row uses `--color-accent-soft` background + 2px `--color-accent` left border (matching `RowShell`).
- [ ] **Empty state** when query is non-empty with zero matches: "No matches" plus a one-line hint that coverage expands as Standalone Runs / Recently Resolved / Mentions land.
- [ ] **Renders nothing when closed** — no portal stays mounted, no input keeps focus.

### Keyboard

- [ ] **⌘K toggles** the palette open/closed from anywhere in the main window. Listener attached at the `MainWindowShell` level.
- [ ] **Esc closes** without changing selection.
- [ ] **↑/↓ moves the cursor** through results, wrapping at the ends.
- [ ] **Enter** selects the cursor row via `useAppStore.getState().setSelectedItemId(item.id)` and closes the palette. The three-pane shell's existing selection logic ([src/hooks/useSelectedItem.test.tsx](../src/hooks/useSelectedItem.test.tsx)) handles the rest.
- [ ] **⌘K is suppressed when an input/textarea inside Settings has focus** — don't hijack the user's keystrokes mid-form.

### Trigger

- [ ] **TitleBar pill becomes a real button** (`<button>` with the same visual treatment as the existing `aria-hidden` div). Takes a new `onOpenSearch: () => void` prop; click opens the palette.
- [ ] **`MainWindowShell`** owns the `searchOpen` state, the global ⌘K keydown registration, and renders `<SearchPalette open={…} onClose={…} />` at the shell root.

### Accessibility

- [ ] Palette card has `role="dialog"` + `aria-label="Search"`. Input has `aria-controls` / `aria-activedescendant` wiring to the focused result row. Result rows have `role="option"` inside a `role="listbox"`.
- [ ] Focus trap: while open, Tab cycles within the palette.
- [ ] Closing restores focus to the TitleBar trigger.

## Files to add / edit

```
src/
├── lib/
│   └── search/
│       ├── index.ts                      ← new: buildCorpus + matchItems
│       └── index.test.ts                 ← new
├── components/
│   ├── SearchPalette.tsx                 ← new
│   ├── SearchPalette.test.tsx            ← new
│   └── MainWindow/
│       ├── TitleBar.tsx                  ← edit: pill → button, onOpenSearch prop
│       ├── TitleBar.test.tsx             ← edit: click-to-open coverage
│       ├── MainWindowShell.tsx           ← edit: searchOpen state, ⌘K listener
│       └── MainWindowShell.test.tsx      ← edit: ⌘K opens palette
```

## Dependencies to add

None. No fuzzy-search library — the matcher is ~30 lines in-tree.

## Test plan

**Unit (Vitest)**

- `src/lib/search/index.test.ts`:
  - Empty query returns `[]`.
  - Substring match on title, repo, number (with and without `#`), author, task id.
  - Initials match (`arc` ↔ "Add rate-limit cache") ranks beneath substring hits.
  - Tie-break by `updatedAt desc` when two items hit at the same position.
- `SearchPalette.test.tsx`:
  - Opens / closes via the `open` prop.
  - Typing filters the list; ↑/↓ wraps; Enter selects via `setSelectedItemId` and calls `onClose`.
  - Esc closes without changing selection.
- `TitleBar.test.tsx`: clicking the search button calls `onOpenSearch`.
- `MainWindowShell.test.tsx`: ⌘K opens the palette; ⌘K again closes it; ⌘K while a Settings input is focused is a no-op.

**Manual**

- With a real PAT and a populated store (Review Requests + In Flight from #3 / #5):
  - Click the pill → palette opens; input focused.
  - ⌘K from anywhere → palette opens or closes.
  - Type a partial title → that PR ranks first.
  - Type `acme/api` → all loaded PRs from that repo appear.
  - Type `#412` and `412` → both find the same PR.
  - Initials (`arc` for "Add rate-limit cache") finds matches in the second bucket.
  - Enter on a result selects it; detail pane updates; palette closes.
  - Esc closes without changing the previously selected row.
- Switch theme (light/dark) and accent (beet/ocean/forest/ink) — palette colours stay coherent.

## Out of scope (deferred)

| Concern | Where it lands |
| --- | --- |
| GitHub API search (issues, repos, code) | Not planned — see Non-goals. |
| Recent searches / search history | Future tweak issue if users ask. |
| Filter-chip DSL (`repo:`, `is:open`, `author:`) | Re-evaluate after the corpus grows past PRs. |
| Indexing Standalone Runs, Recently Resolved, Mentions | Plug into `matchItems` when those sections come online (#6, #8). No matcher changes required — just widen the source array. |
| Action palette ("toggle theme", "refresh now", "open settings") | Separate feature; intentionally not bundled here. |
| Persisted palette state across launches | Local React state; tearing down on close is desired behaviour. |

## Notes

- **Corpus source.** The palette reads the union of `useAppStore`'s `reviewRequests` and `inFlight`. Selecting from `byId` instead would also work, but the explicit lists keep the order deterministic for the `updatedAt` tie-breaker.
- **Selection scrolling.** Once `setSelectedItemId` fires, the existing list pane already scrolls the row into view — no new code needed.
- **Why no fuzzy library.** `fuse.js` and friends add ~10kb and the wrong defaults for this use case (token-aware fuzzy matching on long titles ranks gibberish). The two-pass substring + initials matcher is small, predictable, and easy to test.
