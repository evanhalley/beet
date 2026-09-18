# Open assigned PRs to only the files I own

**Refs:** §5 (ActionableItem model) · §7 (per-PR detail polling) · §11 (main window detail pane)

## Problem

When I'm requested as a reviewer because I'm a code owner, Beet opens the full PR. On cross-team PRs most of the files aren't mine, so I have to dig for the part I'm actually responsible for. GitHub has an "Only files owned by you" filter, but it's off by default and buried in the Files changed tab. Nothing in Beet's list tells me *why* I was requested.

## Goal

When I open a PR from Beet, show only the changed files I (or one of my teams) own by default, with a one-click way to see everything, and mark review requests where I'm a code owner so I can spot them in the list.

## Scope

- **Ownership resolution (Rust):** parse the PR's **base**-branch CODEOWNERS (`.github/CODEOWNERS`, then repo root, then `docs/`; first found wins) with gitignore-style matching where the **last matching rule wins**. No `!` negation, no `[ ]` ranges (invalid lines are skipped, as GitHub does). Renames match on the new path.
- **Team membership:** `GET /user/teams` once per session, cached in memory. If the token lacks `read:org` (403/404), match individual `@user` rules only and show an inline note explaining the gap.
- **Changed files:** `GET /repos/{owner}/{repo}/pulls/{number}/files`, paginated, capped at GitHub's 3,000-file limit. `patch` is never sent to the frontend.
- **Caching:** changed files cached per PR + head SHA; parsed CODEOWNERS cached per repo + base SHA for the session (404s carry no ETag, so this avoids re-asking every poll).
- **Files block (detail pane):** new block under Checks listing changed files with status, +/- stats, and owner pills. Toggle between "My files (n)" and "All files (n)"; the toggle never refetches. A count of files hidden by the filter is always shown. Each row deep-links to that file's diff anchor on GitHub. An "Open my files on GitHub" button opens the Files changed tab with GitHub's owned-by filter applied (`?owned-by[]=<username>`).
- **Badge:** an "owner" pill on Review Requests rows (main window and tray) and "Code owner · n of m files" in the detail header, computed during polling from the same CODEOWNERS + changed-files data.
- **Sidebar filter:** a "Code owner only" toggle in the Filters group narrows the live sections to review requests where I own ≥1 changed file. It's its own axis, AND-ed with the others. In Flight PRs and standalone runs drop out while it's on, since ownership is resolved for review requests only.
- **Mock mode:** fixtures cover all four block states.

## Behavior

| Situation | Files block default | Badge |
|---|---|---|
| I own ≥1 changed file (team or individual rule) | My files | shown |
| I own 0 changed files | All files, with "No files owned by you." | none |
| No CODEOWNERS file in the repo | All files, no toggle | none |
| Token lacks `read:org` | Individual rules only, with a note explaining the gap | from individual rules only |

"Requested directly, not through ownership" can't be distinguished from the API and collapses into the "own 0 files" row.

## Out of scope

- In-app diff rendering (follow-up; the files endpoint already returns `patch`)
- Flagging changes outside my files that affect my code
- Hunk-level ownership (CODEOWNERS is file-level)
- Ownership affecting the priority score (see #45)
- Exposing `requested_teams` on the item

## Acceptance

- [ ] For a PR touching files owned by 3 teams, I see only my team's files by default
- [ ] The toggle switches views without refetching
- [ ] The hidden-file count is accurate
- [ ] Every fallback in the behavior table works as described
- [ ] "Code owner only" in the sidebar Filters group shows only review requests I own files in, and Clear resets it
- [ ] "owner" pill appears on main-window and tray review rows and in the detail header only when I own ≥1 changed file
- [ ] Unit tests cover rule precedence, including a nested-directory case where the last match overrides an earlier one
- [ ] Unit tests cover team vs. individual owners and repos with no CODEOWNERS file
- [ ] Rust tests cover pagination/truncation, CODEOWNERS location fallback, the `read:org` 403 path, and session-cache behavior
