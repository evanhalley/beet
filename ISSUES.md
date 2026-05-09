# Beet — V1 Build Plan

A 9-step iteration plan from empty repo to V1 acceptance (per [SPECS.md §16](SPECS.md)). Each step is shippable on top of the previous and has a clear acceptance test. Detailed write-ups live in [issues/](issues/) and get filed as GitHub issues one at a time.

| # | Iteration | What works at the end | Key new infra | Detail |
|---|---|---|---|---|
| 1 | **Bootstrap** | `npm run tauri dev` opens a window saying "Beet", tray icon present, single-instance enforced. Vitest passes a smoke test. | Tauri 2 + Next.js static export, Tailwind 4, lucide-react, Vitest+MSW, `tauri-plugin-single-instance`, basic tray plumbing. | [issues/01-bootstrap.md](issues/01-bootstrap.md) |
| 2 | **Auth + Octokit + ETag cache** | Settings tab with PAT field; Validate button calls `users.getAuthenticated`; SQLite migration runs on launch. Conditional requests work end-to-end against a recorded fixture. | `tauri-plugin-store` (PAT), `tauri-plugin-sql` (SQLite), Octokit wrapper with ETag cache, scope check. | [issues/02-auth-octokit-etag.md](issues/02-auth-octokit-etag.md) |
| 3 | **Review Requests + scoring** | Port [PRZ scoring](file:///Users/evan/dev/prz/src/lib/pr-prioritization.ts) verbatim and `fetchPrioritizedPRs`. Main window renders the Review Requests section. Show All toggle works. | TanStack Query polling, Zustand store, first real `ActionableItem` rendering. | _tbd_ |
| 4 | **My PRs + In Flight + lifecycle history** | "In Flight (Yours)" populates from `author:@me` search. `Lifecycle` pill renders, including `merge_queue · pos N`. Lifecycle transitions persist to SQLite. | `pr_lifecycle_history` table, merge-queue ejection detection (unread bump only — no notification yet). | _tbd_ |
| 5 | **Workflow runs + collapse + Recently Resolved** | Port Action Jackson's run fetching. Runs with `pull_requests[]` collapse into PR detail's "Checks" block; orphan runs land in Standalone Runs. Recently Resolved section shows last 24 h. | Run-to-PR collapse logic, repo scan window (configurable per §7). | _tbd_ |
| 6 | **Tray popover + window-close-≠-quit** | Click tray icon → popover with all five sections. Badge counts Needs Action + Review Requests unread. Closing the window hides it; tray + polling continue. | Rust-side tray menu, popover window management, app-lifecycle wiring. | _tbd_ |
| 7 | **Mentions hybrid + Needs Action Now + fingerprints** | Notifications inbox poll routes mentions/replies into PR `activity` counts. Needs Action Now section appears. Fingerprint changes flip unread; snooze hides until fingerprint differs. | `item_state` table, fingerprint computation, per-PR comment fallback (detail pane only). | _tbd_ |
| 8 | **OS notifications + mute/pin + adaptive polling** | All 5 §10 triggers fire and dedupe. Mute/Pin work end-to-end (sidebar + Settings). Adaptive intervals respond to window-hidden / battery / rate-limit < 100. | `notifications_sent` dedupe table, `mute_rules`/`pin_rules`, adaptive polling controller. | _tbd_ |
| 9 | **Updater + autostart + final polish** | "Restart to update" wires through `tauri-plugin-updater` against a real Releases manifest. Task chips, pin glyph, density toggle, theme. Hits every item in §16. | `tauri-plugin-updater` + signing key in CI, `tauri-plugin-autostart`, appearance settings, task-URL regex extraction. | _tbd_ |

## Slicing notes

- **Tray ships at #6, not #1.** The first five iterations validate the data layer in a regular window. Trade-off: no glanceable surface until #6, but you're not building UI against dead data either. Reverse if seeing the tray running is what makes the project feel real.
- **#1–#3 rebuild PRZ inside Beet's shell.** Resist the urge to merge #1 + #3 — the SQLite + ETag work in #2 is load-bearing for everything after.
- **#7 is the densest.** Mentions + fingerprints + snooze touch a lot of the data model. Natural sub-cut if it feels too big: 7a "mentions only", 7b "fingerprints + unread/snooze".
