# Beet 🫜 — Specification

A personal, always-running developer dashboard for GitHub. The unified successor
to two prior apps: **PRZ** (PR triage) and **Action Jackson** (workflow run
tracking). Beet is what those two should have been from the start: a single
glanceable surface for everything on GitHub that needs your attention.

---

## 1. Concept & Principles

**Concept.** Slack-for-your-dev-workflow. A surface you leave running, not a
page you visit. A glance answers: *what needs me right now?*

**Principles.**

- **Always-on, ambient.** Lives in the menu bar. Window opens on demand for
  triage.
- **Glanceable over comprehensive.** Counts and one-line items beat dense
  tables.
- **Tight notification budget.** OS notifications fire only on the events the
  user has opted into (see §7). Everything else updates silently.
- **Action-oriented.** The default view is "things needing action." Already
  approved? Drafts? Old? Demoted or hidden by default.
- **Real-time *enough*.** V1 is polling-only. Webhook support is deferred.

---

## 2. Surface

**Two coordinated surfaces, one app:**

1. **Menu bar tray (primary).**
   - Icon shows beet 🫜 + a badge count of *unread actionable items*.
   - Click opens a popover panel with the prioritized list and per-section
     counts.
   - Right-click (or panel menu) for: open main window, refresh now, pause
     polling, settings, quit.
2. **Main window (triage).**
   - Full list with grouping, filters, mute/pin controls.
   - Opened from tray, dock icon, or keyboard shortcut.
   - Closing the window does **not** quit the app (tray keeps running).

The app is single-instance. Window state is restored across launches.

---

## 3. Tech Stack

Reuses the toolchain proven in PRZ + Action Jackson.

| Layer | Choice | Rationale |
|---|---|---|
| Shell | **Tauri 2** | Native tray, OS notifications, small binary, both prior apps already on Tauri. |
| UI framework | **Next.js (static export) + React 19** | Matches PRZ/AJ; static export so Tauri serves the bundle. |
| Styling | **Tailwind 4** | Same as both prior apps. |
| Icons | **lucide-react** | Same as PRZ. |
| GitHub client | **Octokit** | Same as both prior apps. |
| Server state | **TanStack Query** | Inherited from Action Jackson — handles polling, caching, retries. |
| Client state | **Zustand** | Inherited from Action Jackson. |
| Local persistence | **Tauri SQL plugin (SQLite)** | Structured queries for unread state, dismissal fingerprints, mute/pin lists, ETag cache. |
| Token storage | **Tauri Store plugin** | PAT only. Mirrors Action Jackson's `tauri-bridge.ts`. |
| Notifications | **@tauri-apps/plugin-notification** | Same path Action Jackson uses. |
| Auto-update | **tauri-plugin-updater** | In-app updater against a public GitHub Releases feed (§12). |
| Tests | **Vitest + MSW** | Both prior apps already use this. |

### Required Tauri plugins

- `tauri-plugin-store`
- `tauri-plugin-sql` (SQLite)
- `tauri-plugin-notification`
- `tauri-plugin-shell` (open URLs in browser)
- `tauri-plugin-single-instance`
- `tauri-plugin-autostart` (opt-in launch-at-login)
- `tauri-plugin-updater`
- Tray APIs from `tauri::tray` (Rust-side).

---

## 4. Authentication

- **Personal Access Token** pasted by the user into Settings.
- Stored via Tauri Store plugin in `config.json` (key: `github-pat`), same
  pattern as Action Jackson's tauri-bridge.ts.
- **Required scopes** (fine-grained PAT):
  - `repo` (or per-repo: Pull Requests R, Issues R, Actions R, Metadata R,
    Contents R).
  - `read:org` — needed to resolve team membership for prioritization (PRZ
    feature carries forward).
  - `read:user` and `user:email` — for `users.getAuthenticated`.
  - `notifications` — for the notifications inbox query that drives mentions
    and review-reply detection (§7).
- App validates the token on save by calling `users.getAuthenticated`. On 401,
  Beet enters a degraded "token invalid" state — tray icon shows a warning
  glyph; main window prompts for re-entry.
- No OAuth/GitHub App in V1. The spec leaves room for a GitHub App with
  webhooks later (see §13).

---

## 5. Unified Data Model

### `ActionableItem`

The single row type rendered in the UI. Workflow runs collapse into their
parent PR when one exists; standalone runs (deploys, cron jobs, manual
dispatches) get their own row.

```ts
type ActionableKind = "pr" | "standalone_run";

type PrLifecycle =
  | "open"            // Open, not yet review-ready (or in review)
  | "in_review"       // At least one review requested
  | "merge_queue"     // GitHub merge queue accepted it
  | "merged"          // Closed via merge or merge queue
  | "closed";         // Closed without merging

interface ActionableItem {
  id: string;                       // Stable: "pr:owner/repo#123" or "run:owner/repo#456"
  kind: ActionableKind;
  title: string;
  url: string;
  repoFullName: string;
  updatedAt: string;                // ISO

  // Read/unread + dismissal (see §9)
  unread: boolean;
  dismissedUntilFingerprint: string | null;

  // PR fields (kind === "pr")
  pr?: {
    number: number;
    author: string;
    isAuthoredByMe: boolean;
    isReviewRequestedFromMe: boolean;
    isAuthorOnMyTeam: boolean;
    iveCommented: boolean;
    iveReviewed: boolean;
    iveApproved: boolean;
    isDraft: boolean;
    additions: number;
    deletions: number;
    createdAt: string;
    lifecycle: PrLifecycle;
    taskUrls: string[];                // matched by configurable regex (PRZ feature)
    mergeQueue?: {
      position: number | null;       // 1-based; null if not yet known
      enteredAt: string;
      lastEjectionAt?: string;       // populated when re-ejected
    };
    checks: {
      state: "pending" | "success" | "failure" | "neutral" | "skipped";
      failingContexts: string[];     // names of failed required checks
    };
    associatedRuns: AssociatedRun[]; // collapsed workflow runs (most recent per workflow)
    activity: {                       // recent activity directed at me
      mentionsMe: number;             // unread @mentions targeting me
      replyToMyReview: number;        // unread replies on my review threads
      newComments: number;            // unread comments overall
    };
    score: number;                    // priority score (see §6)
  };

  // Standalone run fields (kind === "standalone_run")
  run?: {
    id: number;
    name: string;
    status: "queued" | "in_progress" | "completed" | "waiting" | "requested" | "pending";
    conclusion: "success" | "failure" | "cancelled" | "skipped" | "timed_out" | "action_required" | "neutral" | null;
    event: string;                    // workflow_dispatch | schedule | push (no PR) | ...
    branch: string | null;
    sha: string;
    runNumber: number;
    actor: string;
    startedAt: string | null;
  };
}

interface AssociatedRun {
  id: number;
  workflowName: string;
  status: "queued" | "in_progress" | "completed" | "waiting" | "requested" | "pending";
  conclusion: "success" | "failure" | "cancelled" | "skipped" | "timed_out" | "action_required" | "neutral" | null;
  url: string;
  updatedAt: string;
}
```

### Sections in the UI

The list is filtered/grouped, not paginated. Default sections (in order):

1. **🔴 Needs Action Now** — merge-queue ejections, failing checks on your PRs,
   PRs with unread @mentions/replies to your reviews.
2. **👀 Review Requests** — open PRs where you are a requested reviewer and
   haven't approved.
3. **🚀 In Flight (Yours)** — your authored PRs that are open, in review, or in
   the merge queue.
4. **⚙️ Standalone Runs** — workflow runs you triggered with no PR (deploys,
   `workflow_dispatch`, scheduled runs you started manually).
5. **✅ Recently Resolved** — collapsed; expand to see merged PRs and
   completed runs from the last 24 h.

---

## 6. Prioritization

Inherits and refines the PRZ scoring algorithm from
pr-prioritization.ts.

**Score is computed only for review-request items** (Section 2 above). All
other sections sort by `updatedAt` desc.

```
Base score: 0
+6  author is on a team I'm in
+3  I'm a requested reviewer (not just CC'd via team)
+2  I've commented
+2  I've reviewed
−100  I've approved        // demotes to bottom or hides if showAll=false
−1  additions > 250
−1  deletions > 250
−1  not updated in > 10 days
=0   created > 60 days AND not updated in > 60 days   // stale, drop
−5  draft
−10  author in penalizedBots list
```

Items with `score <= 0` are hidden unless **Show All** is toggled.

---

## 7. Data Sources & Polling

V1 is polling-only. Each query has its own interval and caches its
`If-None-Match` ETag in SQLite to keep rate-limit cost low.

| Query | API call | Default interval | ETag cached |
|---|---|---|---|
| Authenticated user | `users.getAuthenticated` | once per session | no |
| Review requests | `search.issuesAndPullRequests` `q=is:pr is:open review-requested:@me` | 60 s | yes |
| My open PRs | `search.issuesAndPullRequests` `q=is:pr is:open author:@me` | 60 s | yes |
| Per-PR detail | `pulls.get`, `issues.listComments`, `pulls.listReviews`, `pulls.listReviewComments` | 90 s | yes (per PR) |
| PR check status | `checks.listForRef` (head SHA) | 60 s | yes |
| Merge queue state | `pulls.get` (mergeable_state, auto_merge), plus `repos.getCombinedStatusForRef` for the merge_group ref | 60 s for items in queue | yes |
| Workflow runs by actor | `actions.listWorkflowRunsForRepo({ actor })` for each touched repo | 30 s for active, 120 s otherwise | yes |
| Mentions / review replies (primary) | `activity.listNotificationsForAuthenticatedUser` filtered by `reason in {mention, review_requested, comment, author, team_mention}` | 60 s | yes |
| Per-PR comment scan (fallback) | `issues.listComments`, `pulls.listReviewComments` for tracked PRs | 90 s | yes (per PR) |
| Repos list (for run scan) | `repos.listForAuthenticatedUser` | once per 5 min | yes |

**Repo scan cap.** Action Jackson's 200-repo cap carries forward. Beet narrows
this further by default to **repos the user has pushed to in the last 30 days**
plus any **explicitly pinned** repos (see §8). The 30-day window is
**user-configurable in Settings** (§11): 7 / 30 / 90 days. Pinned repos are
always scanned regardless of this setting.

**Adaptive polling.**
- When the main window is hidden, intervals × 2.
- When the system reports power-save / no AC, intervals × 2.
- When an item is in `in_progress` or `merge_queue`, that item gets the fast
  interval; everything else gets the slow one.

**Rate limits.** Beet shows current `X-RateLimit-Remaining` in Settings. If
remaining < 100, intervals × 4 until reset.

### Merge-queue ejection detection

Each PR has a `lifecycle` field tracked in SQLite. On every poll:

1. If `prev.lifecycle === "merge_queue"` and `next.lifecycle !== "merge_queue"`
   *and* `next.lifecycle !== "merged"`, that's an ejection.
2. Beet sets `pr.mergeQueue.lastEjectionAt = now`, marks the item unread,
   bumps it to **Needs Action Now**, and fires an OS notification (§7).

### Workflow run → PR collapse

When fetching workflow runs via `actions.listWorkflowRunsForRepo`, each run
includes `pull_requests[]`. If non-empty and one of those PRs is currently
tracked in the user's open PRs, the run is attached to that PR's
`associatedRuns` and **does not appear as its own row**. Otherwise it surfaces
as a standalone run — including push-event runs without a PR (e.g. main-branch
deploys *and* feature-branch CI). Standalone-run noise is managed via the mute
list rather than a hard filter.

### Mentions ingestion (hybrid)

- The notifications inbox is the **source of truth** for whether the badge
  should light up: the polled `activity.listNotificationsForAuthenticatedUser`
  call returns one row per thread with a `reason` field. Routing:
  - `reason = mention` or `team_mention` → bumps `pr.activity.mentionsMe`
  - `reason = comment` and the thread is a review thread I authored → bumps
    `pr.activity.replyToMyReview`
  - `reason = review_requested` → marks the PR as a fresh review request
- The per-PR comment scan is **only** invoked for items already on screen in
  the detail pane, so we can render comment bodies inline without an extra
  blocking fetch when the user clicks. No comment-bodies are fetched for
  off-screen PRs.

---

## 8. Filters: Mute & Pin

Per the user's scope choice: "everything by default, with mute/include
filters."

- **Mute (repo or org).** Items from muted repos/orgs do not appear in any
  section and do not contribute to badge counts. Mute is reversible from
  Settings.
- **Pin (repo).** Pinned repos always poll on the fast interval, never get
  demoted by the 30-day push window, and are highlighted in the UI.
- Mute and pin lists are stored in SQLite (`mute_rules`, `pin_rules` tables).
- Bulk action: from any item row, "Mute repo `owner/foo`" / "Pin repo
  `owner/foo`" via context menu.

---

## 9. State Persistence

SQLite database in the Tauri app data dir. Schema (V1):

```sql
-- Per-item read/unread + dismissal
CREATE TABLE item_state (
  id TEXT PRIMARY KEY,                    -- ActionableItem.id
  unread INTEGER NOT NULL DEFAULT 1,
  dismissed_until_fingerprint TEXT,       -- when set, item hidden until fingerprint changes
  last_seen_fingerprint TEXT NOT NULL,    -- for change detection
  updated_at TEXT NOT NULL
);

-- PR lifecycle history (for ejection detection)
CREATE TABLE pr_lifecycle_history (
  pr_id TEXT NOT NULL,                    -- "owner/repo#123"
  lifecycle TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (pr_id, observed_at)
);

-- ETag cache for conditional requests
CREATE TABLE etag_cache (
  cache_key TEXT PRIMARY KEY,             -- e.g. "search:review-requested:@me"
  etag TEXT NOT NULL,
  body_json TEXT NOT NULL,                -- last response body
  fetched_at TEXT NOT NULL
);

-- Mute rules
CREATE TABLE mute_rules (
  scope TEXT NOT NULL,                    -- "repo" | "org"
  value TEXT NOT NULL,                    -- "owner/repo" or "owner"
  created_at TEXT NOT NULL,
  PRIMARY KEY (scope, value)
);

-- Pin rules
CREATE TABLE pin_rules (
  value TEXT PRIMARY KEY,                 -- "owner/repo"
  created_at TEXT NOT NULL
);

-- Notification dedupe
CREATE TABLE notifications_sent (
  dedupe_key TEXT PRIMARY KEY,            -- e.g. "ejection:owner/repo#123:2026-05-09T12:00Z"
  fired_at TEXT NOT NULL
);
```

### Fingerprints

A fingerprint summarizes the *actionable state* of an item. Used for:

- **Unread reset.** When the fingerprint changes, `unread` is set to `1`.
- **Snooze re-emergence.** A user dismisses an item until its state changes:
  `dismissed_until_fingerprint = current fingerprint`. Item reappears when
  fingerprint differs.

PR fingerprint composition:
`{lifecycle}|{checks.state}|{activity.mentionsMe}|{activity.replyToMyReview}|{associatedRuns hash of (id, status, conclusion)}`

Standalone-run fingerprint:
`{status}|{conclusion}|{run.id}`

---

## 10. Notifications

Native OS notifications via `@tauri-apps/plugin-notification`, dedupe-keyed in
`notifications_sent`.

| Trigger | Title | Body | Dedupe key |
|---|---|---|---|
| **PR ejected from merge queue** (high priority) | `🚨 Kicked from merge queue: {title}` | `{repo} #{number} · {reason if available}` | `eject:{prId}:{ejectionAt}` |
| **Failing checks on your PR** | `❌ Checks failing: {title}` | `{repo} #{number} · {failingContexts.slice(0,2).join(", ")}` | `checks-fail:{prId}:{headSha}` |
| **New review request for you** | `👀 Review requested: {title}` | `{repo} #{number} · by @{author}` | `review-req:{prId}` |
| **Comment / @mention directed at you** | `💬 @{author} mentioned you` | `{repo} #{number} · {body excerpt}` | `mention:{commentId}` |
| **A workflow run you triggered finished** | `{workflowName} {succeeded \| failed \| was cancelled}` | `{repo} · {branch or sha}` | `run:{runId}:{conclusion}` |

**Behavior rules.**

- A check failure fires once per head SHA. Re-runs that fail again on the same
  SHA do not re-notify.
- Successes do **not** notify by default for PR checks (only standalone runs do
  per the user's choice). Failures do.
- Notifications respect Do Not Disturb at the OS level (Tauri delegates).
- Each notification kind is individually toggleable in Settings.

Tray badge count = number of `unread` items in **Needs Action Now** + **Review
Requests**. (Items in *In Flight (Yours)* and *Standalone Runs* update the
list silently.)

---

## 11. UI Surfaces

### Tray popover (~360 × 480)

```
┌─────────────────────────────┐
│ 🫜 Beet      ↻ ⚙   ✕        │
├─────────────────────────────┤
│ 🔴 Needs Action  (2)        │
│   #412 ejected · auth-fix   │
│   #389 ❌ tests · billing   │
├─────────────────────────────┤
│ 👀 Review Requests  (3)     │
│   #501 by @rina · platform  │
│   #498 by @kai  · gateway   │
│   #492 by @mo   · search    │
├─────────────────────────────┤
│ 🚀 In Flight (Yours)  (1)   │
│   #412 (mq pos 2) · auth-fix│
├─────────────────────────────┤
│ ⚙️  Standalone Runs (0)     │
├─────────────────────────────┤
│ Open Beet ↗                 │
└─────────────────────────────┘
```

- Each row is clickable → opens GitHub URL in default browser via
  `tauri-plugin-shell`.
- Hovering a row reveals: ✓ Mark read · 💤 Snooze · 🔇 Mute repo.
- **Task chips.** When `pr.taskUrls` is non-empty, the matched task IDs render
  as small clickable chips on the PR row (e.g. `PROJ-123`). Click opens the
  ticket in browser. Chips are derived from the configurable Task URL regex
  inherited from PRZ; default is the Atlassian pattern. Up to 3 chips per row,
  with a `+N` overflow chip for the rest (full list in the detail pane).
- Section headers are collapsible (state persisted).

### Main window

Three-pane: **Sidebar** (sections + filters) · **List** (items, with
prioritization scores visible) · **Detail** (selected item — recent activity,
checks, associated runs, quick actions). Reuses Action Jackson's `RunCard`,
`StatusBadge`, `FilterBar` components and PRZ's PR-rendering primitives.

### Settings

- GitHub PAT (with Validate button + scopes status).
- Username override (auto-detected; editable for testing).
- Teams to track (carries forward from PRZ — `org/team` strings).
- Penalized bots list (carries forward from PRZ).
- Task URL regex (carries forward from PRZ).
- Per-notification toggles (the 5 from §10).
- Polling interval (default 60 s; can be set 15 s – 600 s).
- Repo scan window (7 / 30 / 90 days; default 30 — see §7).
- Auto-launch on login toggle (`tauri-plugin-autostart`).
- Mute & Pin management.
- Show approved PRs (showAll toggle).
- Theme (auto/light/dark).
- Density (compact / comfy).
- Show priority score on rows (toggle; on by default).
- Rate limit display (read-only).

---

## 12. App Lifecycle

- **Start.** Tauri Rust side creates tray + hidden main window. Frontend boots,
  loads PAT from store, validates token, kicks off TanStack Query polling.
- **Window close.** Hides window; tray and polling continue.
- **Tray "Pause polling".** Toggles a global flag in Zustand; queries skip
  refetch while paused. Tray icon shows a paused glyph.
- **Tray "Quit".** Real exit.
- **Login items.** Auto-launch on login is **opt-in** in Settings via Tauri's
  `autostart` plugin (added when wired).
- **Single instance.** `tauri-plugin-single-instance` ensures only one Beet
  runs.

### Auto-update

- **Mechanism.** `tauri-plugin-updater` checks an `updates.json` manifest at a
  fixed URL on launch and once every 24 h thereafter.
- **Distribution.** Builds + signed manifests are published to GitHub Releases
  on the Beet repo. Manifest URL points at the release asset.
- **Signing.** A Tauri updater key pair is generated; the public key is
  embedded in `tauri.conf.json`. The private key lives only on the release
  machine / in CI secrets — **never committed**.
- **UX.** When an update is available, the tray menu gains a "Restart to
  update" item; main window shows a non-blocking banner. No silent restarts.
- **Channels.** V1 ships a single `stable` channel. Beta channel deferred.

---

## 13. Out of Scope for V1 (explicit non-goals)

- **Webhooks.** Polling only. Webhook support requires a hosted relay or local
  tunnel; not worth the infra in V1.
- **GitHub App auth.** PAT only.
- **Multi-account.** One GitHub identity per Beet install.
- **Writing back to GitHub.** Beet is read-mostly. The only write actions are
  *opening URLs in browser*. No "approve from Beet," no "comment from Beet."
- **Custom dashboards / saved views.** The five sections are fixed.
- **Mobile / web.** Desktop only.
- **Windows / Linux.** **macOS is the only supported platform in V1.** Tauri
  will produce Windows and Linux artifacts as a by-product of the build, but
  Beet does not test, QA, or claim correctness on those platforms. Tray
  badging, autostart, and updater behavior in particular vary enough that
  shipping them as "supported" would create false expectations. Cross-platform
  is a V2 question.

---

## 14. Migration Plan (PRZ + Action Jackson → Beet)

| From | What carries over | Where it lives in Beet |
|---|---|---|
| PRZ `github.ts` | `parseRepoAndOwnerFromURL`, `fetchPrioritizedPRs` (search query, team resolution, task-URL regex) | `src/lib/github/prs.ts` |
| PRZ `pr-prioritization.ts` | `scorePullRequests` algorithm + tests | `src/lib/scoring.ts` |
| AJ `lib/github.ts` | `fetchUser`, `fetchRepos`, `fetchAllRuns`, `fetchRunsForRepo` | `src/lib/github/runs.ts` |
| AJ `lib/store.ts` | Zustand store pattern (filters, settings, runs) | `src/lib/store.ts` (extended for PRs and ActionableItems) |
| AJ `hooks/useNotifications.ts` | Tauri notification permission + sendNotification flow | `src/hooks/useNotifications.ts` (extended with the 5 triggers from §10) |
| AJ `hooks/useWorkflowRuns.ts` | TanStack Query + Zustand sync pattern | `src/hooks/useActionableItems.ts` (one hook drives the unified list) |
| AJ `lib/tauri-bridge.ts` | PAT storage helpers | `src/lib/storage/token.ts` |
| AJ `components/{StatusBadge,RunCard,FilterBar,RunList}` | UI primitives | `src/components/` (renamed/generalized as needed) |
| AJ `test/msw-handlers.ts`, vitest setup | Test infra | `src/test/` |

**New code Beet must add:**

- Merge-queue lifecycle tracking + ejection detection (§7).
- Run-to-PR collapse logic (§7).
- SQLite schema and DAL (§9) — use `tauri-plugin-sql`.
- ETag-conditional Octokit wrapper (§7).
- Tray icon + popover UI in Rust + React (§2, §11).
- Fingerprint computation + dismissal/unread machinery (§9).
- Adaptive polling controller (§7).

---

## 15. Resolved Decisions

These were the V1 open questions; recording the answers here so future
contributors don't re-litigate them.

1. **Mentions source — hybrid.** Notifications inbox
   (`activity.listNotificationsForAuthenticatedUser`) is primary and drives
   the badge/notification path. Per-PR comment scans are fallback: invoked
   only for items currently visible in the detail pane to fetch comment
   bodies inline. Requires `notifications` scope. (Spec: §4, §7.)
2. **Task URLs — render as chips on PR rows.** Up to 3 chips per row with a
   `+N` overflow chip; full list in the detail pane. Regex remains
   user-configurable, defaults to PRZ's Atlassian pattern. (Spec: §5, §11.)
3. **Push runs without a PR — surface all of them as standalone.** Do not
   filter by branch. Mute list is the user's lever for noise control.
   (Spec: §7.)
4. **Platform scope — macOS only.** Windows/Linux are not supported targets
   in V1. (Spec: §13.)
5. **Auto-update — `tauri-plugin-updater` against GitHub Releases.** Single
   `stable` channel, signed manifests, user-initiated restart. (Spec: §3,
   §12.)

---

## 16. V1 Acceptance Criteria

Beet ships when:

- ✅ Tray icon launches on macOS, badge updates within one poll cycle of an
  item becoming unread.
- ✅ Main window shows the five sections; clicking a row opens GitHub.
- ✅ Review-request PRs are scored using the PRZ algorithm and rendered with a
  visible score.
- ✅ Workflow runs collapse into PR rows when the run reports a parent PR;
  otherwise show as standalone.
- ✅ A PR moving from `merge_queue` to non-merged fires the high-priority
  notification exactly once.
- ✅ The 5 notification triggers in §10 each fire and dedupe correctly under
  test (use MSW to simulate state transitions).
- ✅ Mute and Pin work; muted items do not appear or count; pinned repos poll
  on the fast interval.
- ✅ Closing the main window does not stop polling or hide the tray.
- ✅ PAT is stored via Tauri Store, validated on save, and surfaces a clear
  error state on 401.
- ✅ ETag conditional requests are sent for the queries marked in §7;
  rate-limit remaining is visible in Settings.
- ✅ Notifications inbox poll routes mentions and review replies into the
  correct PR's `activity` counts; per-PR scan populates comment bodies in the
  detail pane only.
- ✅ Matched task URLs render as clickable chips on PR rows (max 3 + overflow)
  and a full list in the detail pane.
- ✅ Standalone push-event runs (deploys, post-merge jobs, feature-branch CI
  with no PR) appear in the Standalone Runs section; muting is the noise
  control.
- ✅ The updater checks GitHub Releases on launch + every 24 h; "Restart to
  update" appears in tray + main window when a new version is available.
