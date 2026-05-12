# #3 — Review Requests + scoring

Port PRZ's prioritization end-to-end and put the first real `ActionableItem` rows on screen. Search GitHub for `review-requested:@me`, resolve team membership, score with the unchanged PRZ algorithm, and render the **Review Requests** section in the main window. Add the Settings tabs the scoring inputs live on (Polling, Scoring) plus the Teams field on Account.

Refs: [SPECS.md §5](../SPECS.md) (`ActionableItem`), [§6](../SPECS.md) (scoring algorithm — verbatim), [§7](../SPECS.md) (Review Requests + My open PRs query rows; this issue does the first one), [§11](../SPECS.md) (Settings → Scoring + Polling tabs), [§14](../SPECS.md) (migration: `pr-prioritization.ts` → `src/lib/scoring.ts`, `github.ts` → `src/lib/github/prs.ts`). Builds on [#2](02-auth-octokit-etag.md).

## Goal

User opens the main window, sees the **Review Requests** section populated with scored, sorted PRs from `search.issuesAndPullRequests` `q=is:pr is:open review-requested:@me`. The score the rows display matches what PRZ would have shown for the same input.

## Acceptance criteria

- [ ] **Scoring is a verbatim port.** [pr-prioritization.ts](file:///Users/evan/dev/prz/src/lib/pr-prioritization.ts) moves to `src/lib/scoring.ts` with no logic changes — same weights, same thresholds, same `score = 0` stale rule, same `-10` penalized-bot reset. The existing [pr-prioritization.test.ts](file:///Users/evan/dev/prz/src/lib/pr-prioritization.test.ts) ports alongside it and passes.
- [ ] **`fetchReviewRequests`** in `src/lib/github/prs.ts` does what PRZ's `fetchPrioritizedPRs` does, on top of #2's ETag wrapper:
  - Runs the search query through `beetGet` with `cacheKey: "search:review-requested:@me"`.
  - Resolves team membership via `octokit.teams.listMembersInOrg` for each `org/team` in settings (cached, one `cacheKey` per team).
  - For each search hit, fetches `pulls.get` + `issues.listComments` + `pulls.listReviews` in parallel (each ETag-cached at `cacheKey: "pr:{owner}/{repo}#{num}:{detail,comments,reviews}"`).
  - Extracts task URLs from the PR body via the user-configurable regex (default `https://your-company\.atlassian\.net/browse/[A-Z]+-\d+`), de-duped.
  - Returns `ActionableItem[]` (kind `"pr"`) per §5 — not PRZ's `PullRequestInsights` shape. The mapping happens here so the rest of the app only sees the unified model.
- [ ] **`useReviewRequests`** TanStack Query hook polls every 60 s (the default from §7), syncs results into a Zustand `actionableItems` slice keyed by `ActionableItem.id`, and updates rate-limit numbers in the store on every successful response.
- [ ] **Main window renders the Review Requests section** per [design/src/main-window.jsx](../design/src/main-window.jsx):
  - Section header with title, count badge, collapsible.
  - Rows match the design's `review` item type: avatar, title, repo, `ScoreBar`, `TaskChips` (up to 3 + `+N`), `Pill` for lifecycle.
  - Click a row → opens `item.url` in browser via `tauri-plugin-shell`.
  - Empty state: "No review requests right now."
- [ ] **Show All toggle** in the section header reveals score ≤ 0 items (approved, stale, draft, penalized). State lives in Zustand, persisted to localStorage. Off by default.
- [ ] **Settings → Account tab** gains a **Teams to track** field: a list of `org/team` strings (one per line, trimmed). Persisted via `tauri-plugin-store`, key `teams`. Empty list is valid (= no team-bonus scoring).
- [ ] **Settings → Scoring tab** (new tab; register in `SettingsPanel`):
  - **Weights table** (read-only) — the §6 rule list, shown so users can see how scoring works. No knobs in V1.
  - **Penalized bots** — list of GitHub logins; pass-through into `scorePullRequests`'s third arg. Persisted, key `penalizedBots`.
  - **Task URL regex** — text input, default = PRZ's Atlassian pattern. Accept both `pattern` and `/pattern/flags` forms. Persisted, key `taskRegex`. Show a one-line preview that runs the regex against a sample string to confirm it parses.
  - **Show approved PRs** — toggle (this is the global "Show All" default; the per-section toggle from the criterion above overrides it for the current session).
- [ ] **Settings → Polling tab** (new tab):
  - **Polling interval** — slider 15 s – 600 s, default 60 s. Persisted, key `pollingIntervalSec`. Drives the `useReviewRequests` refetch interval.
  - **Rate limit display** — `{remaining} / {limit}` + reset countdown, read from the Zustand store populated by #2. Updates live.
- [ ] No data is rendered for sections we haven't built yet. The main window shows the Review Requests section + an empty-state hint for the other four ("In Flight (Yours), Standalone Runs, Recently Resolved land in later iterations"). Don't pre-stub them as empty real sections — that invites confusion about whether they're broken or unwritten.
- [ ] All tests pass (`npm test`), lint clean (`npm run lint`), `npm run tauri build` succeeds.

## Files to add

```
src/
├── app/
│   └── page.tsx                              ← gains Review Requests section + Show All toggle
├── components/
│   ├── ReviewRequestsSection.tsx
│   ├── ActionableRow.tsx                     ← shared row primitive — only the "review" variant lights up here
│   ├── ScoreBar.tsx                          ← port design/src/ui.jsx ScoreBar
│   ├── TaskChips.tsx                         ← port design/src/ui.jsx TaskChips
│   ├── Pill.tsx                              ← port design/src/ui.jsx Pill
│   ├── Avatar.tsx                            ← port design/src/ui.jsx Avatar
│   └── Settings/
│       ├── AccountTab.tsx                    ← extended: Teams field
│       ├── ScoringTab.tsx                    ← new
│       └── PollingTab.tsx                    ← new
├── hooks/
│   └── useReviewRequests.ts
├── lib/
│   ├── github/
│   │   ├── prs.ts                            ← port of PRZ github.ts → returns ActionableItem[]
│   │   └── teams.ts                          ← team-member resolution helper
│   ├── scoring.ts                            ← verbatim port of pr-prioritization.ts
│   ├── tasks.ts                              ← regex compile + match helper
│   └── store.ts                              ← extended: actionableItems, showAll, settings slice
└── test/
    ├── fixtures/
    │   ├── search-review-requested.json
    │   ├── pulls-get-{owner-repo-num}.json
    │   ├── issues-list-comments-{...}.json
    │   ├── pulls-list-reviews-{...}.json
    │   └── teams-list-members.json
    └── msw-handlers.ts                       ← extended with the above fixtures

src/lib/scoring.test.ts                       ← ported from PRZ pr-prioritization.test.ts
src/lib/github/prs.test.ts                    ← new
src/lib/tasks.test.ts                         ← new
src/hooks/useReviewRequests.test.tsx          ← new
src/components/ReviewRequestsSection.test.tsx ← new
```

## Dependencies to add

None — `@octokit/rest`, `@tanstack/react-query`, `zustand`, `dayjs`, `msw` all landed in #2.

## `ActionableItem` shape (subset built here)

Only the fields needed for review-request rendering and scoring. The rest (`mergeQueue`, `checks`, `associatedRuns`, `activity`, `lifecycle` transitions) get populated in #4 and #5.

```ts
// src/lib/types.ts (new)
export interface ActionableItem {
  id: string;                                 // "pr:owner/repo#123"
  kind: "pr";                                 // standalone_run lands in #5
  title: string;
  url: string;
  repoFullName: string;
  updatedAt: string;
  unread: boolean;                            // hardcoded `true` until #7 wires fingerprints
  dismissedUntilFingerprint: null;            // ditto
  pr: {
    number: number;
    author: string;
    isAuthoredByMe: boolean;                  // false here — author:@me query lands in #4
    isReviewRequestedFromMe: boolean;
    isAuthorOnMyTeam: boolean;
    iveCommented: boolean;
    iveReviewed: boolean;
    iveApproved: boolean;
    isDraft: boolean;
    additions: number;
    deletions: number;
    createdAt: string;
    lifecycle: "open" | "in_review";          // full enum lands in #4
    taskUrls: string[];
    score: number;
  };
}
```

## Scoring API — exact port

The signature stays as in PRZ so the test file ports without edits, but the input/output types change to match Beet's model:

```ts
// src/lib/scoring.ts
export function scorePullRequests(
  items: ActionableItem[],          // kind === "pr"
  showAll: boolean,
  penalizedBots: string[],
): ActionableItem[];                // same items, `pr.score` populated, sorted desc, filtered when !showAll
```

Adapter shim inside `scoring.ts` reads from `item.pr` using the same field semantics PRZ's algorithm assumed (`isRequestorTeamMember` → `pr.isAuthorOnMyTeam`, etc.). Zero logic changes — the algorithm is unchanged, only the field names it dereferences differ.

## Settings field summary

| Key (Tauri Store) | Type | Default | Used by |
|---|---|---|---|
| `teams` | `string[]` | `[]` | team-membership resolver → `isAuthorOnMyTeam` |
| `penalizedBots` | `string[]` | `[]` | `scorePullRequests` |
| `taskRegex` | `string` | `"https://your-company\\.atlassian\\.net/browse/[A-Z]+-\\d+"` | task-URL extraction |
| `pollingIntervalSec` | `number` | `60` | TanStack Query `refetchInterval` |
| `showAllApproved` | `boolean` | `false` | section-level Show All default |

## Test plan

**Unit (Vitest + MSW)**

- `src/lib/scoring.test.ts` — full PRZ test suite ported. Same inputs (rewritten to the new field names where needed) → same outputs. If a PRZ test diverges, treat the divergence as a bug in this issue, not a spec change.
- `src/lib/tasks.test.ts` — regex parsing (raw `pattern`, `/pattern/flags`, invalid input falls back to `null`), match-and-dedupe.
- `src/lib/github/prs.test.ts`:
  - Search returns 3 items → all detail/comments/reviews fixtures resolve → returns 3 `ActionableItem`s with the right `score`s.
  - Search returns 0 items → returns `[]` without firing any detail fetches.
  - One PR's `pulls.get` errors → that PR is dropped, the others still return.
  - Teams list contains `acme/platform` → membership resolution invoked once, results plumbed into `isAuthorOnMyTeam`.
  - Second invocation with unchanged fixtures hits `304` on every cached call (asserts the wrapper actually short-circuits).
- `src/hooks/useReviewRequests.test.tsx` — refetch on interval, syncs into Zustand, surfaces rate-limit headers.
- `src/components/ReviewRequestsSection.test.tsx` — renders rows, sorts by score desc, Show All toggle reveals score ≤ 0 rows.

**Manual**

- Paste a real PAT (from #2), add at least one team in Account, observe Review Requests populate within ~60 s.
- Toggle Show All — approved/draft PRs appear at the bottom of the list.
- Set `pollingIntervalSec` to 15 s, watch the network tab — refetch cadence matches.
- Set `taskRegex` to a pattern that matches a PR body you have open — chips appear on the row.
- Set rate-limit to near-zero (use a throwaway PAT or wait); the Polling tab reflects it. Adaptive `× 4` slowdown lands in #8, not here, so just verify the number is correct.

## Out of scope (deferred)

| Concern | Lands in |
|---|---|
| `author:@me` search (In Flight Yours) + lifecycle pill | #4 |
| Merge-queue detection, `pr_lifecycle_history` table | #4 |
| Workflow runs (associated + standalone) | #5 |
| Recently Resolved section | #5 |
| Tray popover surface | #6 |
| Mentions/replies in `pr.activity` counts | #7 |
| Fingerprints, real `unread`, snooze | #7 |
| OS notifications | #8 |
| Mute/Pin (sidebar + Settings tab) | #8 |
| Adaptive polling (× 2 hidden, × 2 battery, × 4 low rate-limit) | #8 |
| Scoring tab weights becoming editable | not planned for V1 |

## Notes

- The PRZ search query is the canonical one — `is:pr is:open review-requested:${username}`. The §7 table writes it as `review-requested:@me`; that's the equivalent self-reference form. Use the resolved username (already in the Zustand store from #2's validate flow) so the ETag cache key is stable across token rotations.
- `fetchReviewRequests` should issue per-PR detail fetches concurrently (PRZ uses `Promise.all`); don't serialize. The ETag cache makes the second poll cheap regardless.
- The PRZ algorithm has a wart: `if (penalizedBots.includes(pr.requestor)) score = -10` *overwrites* the score instead of adding to it. That's intentional — port it verbatim. Don't "fix" it.
- The `score = 0` stale rule (created > 60 d AND not updated > 60 d) similarly overwrites. Same — port verbatim.
- `ActionableRow.tsx` is generalized now even though only the `review` variant has real data, because #4 lights up the `inflight` variant on the same component a week later. Keep the variant prop in mind when porting [design/src/main-window.jsx](../design/src/main-window.jsx) — the design already distinguishes `type="needs" | "review" | "inflight" | "run"`.
- Don't add a "Refresh now" button yet — the tray menu owns that in #6. Avoid putting it on the main window only to relocate it.
- Pixel match: `ScoreBar` width is 26 in the list (per [design/src/main-window.jsx:247](../design/src/main-window.jsx)), 36 in the detail header, 20 in the tray. Carry the width prop through.
