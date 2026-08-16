# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo state

The app is scaffolded and shipping releases (`v0.1.6` as of this writing) — this is no longer a pre-scaffold repo. Issues #1–#7, #9, plus most side-quest issues (search, sidebar filters, merge-queue auto-requeue, release workflow) are closed; #8 (mentions hybrid + Needs Action Now + fingerprints) and #10 (updater + autostart + final polish) are still open. The repo is public/open source under MIT.

**[SPECS.md](SPECS.md) is the source of truth** for what Beet is, what it does, and how it should be built. Read it before making implementation decisions. Section numbers below refer to SPECS.md.

## What Beet is

Beet 🫜 is a personal, always-running developer dashboard for GitHub — a menu-bar Tauri app that surfaces PRs needing action, your authored PRs (with check status / merge-queue position), workflow runs you triggered, and @mentions/review-replies directed at you. It consolidates the functionality of two earlier PR-triage / workflow-run apps the author wrote into a single tool.

Core design principle: **glanceable over comprehensive**, **tight notification budget**, **action-oriented**. The default view answers *what needs me right now?* — already-approved PRs, drafts, and stale items are demoted or hidden.

## Tech stack (locked by §3 of SPECS.md)

- **Tauri 2** shell with macOS menu bar tray + main window
- **Next.js (static export) + React 19** frontend
- **Tailwind 4** styling, **lucide-react** icons
- **Octokit** for GitHub API; **TanStack Query** for polling/caching; **Zustand** for client state
- **Tauri SQL plugin (SQLite)** for local persistence (unread state, ETag cache, mute/pin lists, dismissal fingerprints)
- **Tauri Store plugin** for the PAT
- **Vitest + MSW** for tests
- **macOS only in V1** — Windows/Linux are explicitly unsupported (§13)

V1 is **polling-only** with ETag conditional requests. No webhooks, no GitHub App, no OAuth. Auth is a Personal Access Token pasted into Settings.

## Heritage

Beet consolidates two earlier apps the author wrote — a PR-triage app and a workflow-run tracker. The patterns those apps established now live in this repo:

- GitHub fetching (`parseRepoAndOwnerFromURL`, prioritized-PR search via `search.issuesAndPullRequests` with `review-requested:${user}`, team-membership resolution, task-URL extraction, workflow-run fetching with `actor` filter) → `src/lib/github/`.
- The PR-prioritization scoring algorithm (§6) → `src/lib/`.
- PAT storage via `@tauri-apps/plugin-store`, notification permission + `sendNotification`, and the TanStack Query → Zustand sync pattern → `src/lib/storage/`, `src/hooks/`.
- Reusable UI primitives (status badges, run cards, filter bar, lists) → `src/components/`.

## Match the design mockups

[design/](design/) is the visual source of truth. When implementing UI, run `./design/serve.sh` and compare against the rendered mockup — pixel layouts, spacing, color tokens, row anatomy, hover states, and component composition should match what's in [design/src/](design/src/). If the spec and the design disagree, surface it before diverging from either; don't silently invent a third option. Components to mirror exist in [src/tray.jsx](design/src/tray.jsx), [src/main-window.jsx](design/src/main-window.jsx), [src/settings.jsx](design/src/settings.jsx), and the shared primitives in [src/ui.jsx](design/src/ui.jsx) (`Pill`, `CheckDot`, `Avatar`, `ScoreBar`, `ReasonBadge`, `Lifecycle`, `RunStatus`, `TaskChips`, `PinGlyph`, `BeetMark`).

## Key architectural decisions to remember

These are the load-bearing concepts that span multiple files and are easy to get wrong if you only read one piece:

- **Unified `ActionableItem` model (§5).** Both PRs and workflow runs render as the same row type. Workflow runs **collapse into their parent PR** when `pull_requests[]` is non-empty and that PR is tracked; otherwise they surface as standalone runs (§7). All push-event runs without a PR are surfaced — branch filtering is *not* used; the mute list is the noise control.
- **Five fixed sections, not paginated lists.** Needs Action Now → Review Requests → In Flight (Yours) → Standalone Runs → Recently Resolved. Tray badge counts items in the first two only.
- **Mentions are hybrid (§7).** `activity.listNotificationsForAuthenticatedUser` is the primary signal that drives the badge — route by `reason` (`mention`, `team_mention`, `comment`, `review_requested`). Per-PR `listComments`/`listReviewComments` is fallback, called **only** for items currently visible in the detail pane.
- **Fingerprints drive unread + snooze (§9).** Each item has a fingerprint summarizing its actionable state (lifecycle | checks | mentionsMe | replyToMyReview | runs hash). When the fingerprint changes, `unread = 1`. "Dismiss until it changes" stores the current fingerprint in `dismissed_until_fingerprint`; the item reappears when fingerprints differ.
- **Merge-queue ejection is the highest-priority event (§7, §10).** Detected by tracking PR `lifecycle` history in SQLite: a transition out of `merge_queue` that isn't into `merged` fires the high-priority notification exactly once.
- **Adaptive polling (§7).** Window hidden / on battery → intervals × 2. Rate-limit remaining < 100 → × 4. In-flight items poll fast; everything else slow. Pinned repos always poll fast.
- **Window close ≠ quit (§12).** Closing the main window hides it; tray + polling continue. Only "Quit" from the tray menu exits the process. `tauri-plugin-single-instance` enforces one Beet at a time.
- **Updater (§12).** `tauri-plugin-updater` against a public GitHub Releases manifest; user-initiated restart, never silent. Updater key pair: public key in `tauri.conf.json`, private key in CI secrets only.

## Scoring algorithm (§6)

Score is computed only for review-request items. Other sections sort by `updatedAt` desc.

```
+6 author on a team I'm in    +3 I'm a requested reviewer
+2 I've commented             +2 I've reviewed
−100 I've approved (demote/hide unless showAll)
−1 additions > 250            −1 deletions > 250
−1 not updated in > 10 days
=0  created > 60d AND not updated in > 60d  (stale, drop)
−5 draft                      −10 author in penalizedBots
```

Items with `score <= 0` are hidden unless **Show All** is on.

## Commands

- `npm install` — install deps
- `npm run tauri dev` — run the desktop app in dev mode (boots Next.js + Tauri window)
- `npm run tauri:mock` — same, in demo mode (`BEET_MOCK=1`, fixture data, no PAT/network needed)
- `npm run tauri build` — produce `.app`/`.dmg` in `src-tauri/target/release/bundle`
- `npm run lint` — ESLint (`--max-warnings 0`)
- `npm test` / `npx vitest` — run the unit tests
- `npx vitest path/to/file.test.ts` — single test file
- `npx vitest -t "test name"` — single test by name
- `cargo build --manifest-path src-tauri/Cargo.toml --locked` — Rust build, matches CI
- `cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings` — Rust lint, matches CI

See [README.md](README.md) for the full command list, including icon regeneration.

Source is laid out as `src/app/`, `src/lib/` (with `src/lib/github/` and `src/lib/storage/`), `src/hooks/`, `src/components/`, `src/test/`, and the Tauri shell in `src-tauri/`.

## GitHub CLI

`gh` is installed and authed as `evanhalley`. Use it for all GitHub interactions — filing issues, reading issues/PRs, creating PRs, checking CI status. The repo is at `github.com:evanhalley/beet`. The build plan in [ISSUES.md](ISSUES.md) gets filed one issue at a time as we work through it; per-issue write-ups live in [issues/](issues/) and become issue bodies via `gh issue create --body-file issues/NN-name.md`.

## Development

When making changes:
- create branches for your work, `IssueNumber-ShortIssueName` example: `01-bootstrap`
- add tests to cover new functionality
- unit tests for business logic and components
- functional tests for end to end flows
- all tests, existing and new, need to pass
- make sure code is formatted and passes lint check