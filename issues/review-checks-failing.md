# "Checks failing" label + score weight on Review Requests

**Refs:** §5 (ActionableItem model) · §6 (scoring) · `src/lib/needsAction.ts` · `src-tauri/src/scoring.rs`

## Goal

Today the red **Checks failing** pill only appears on PRs **I author**: the `checks_failing` reason in `needsActionReasons` is gated on `pr.isAuthoredByMe`. A PR I've been asked to review whose CI is red shows no failing-checks signal at all in the main-window list (the `review` row variant has no check indicator), and the tray review row's `CheckDot` only reflects `checkRuns[0]`, so a later failing check reads as green.

Knowing a review request is red matters for triage. It is often a sign to wait for the author to fix CI before spending review time.

1. Show the **Checks failing** pill on review-request rows whenever the PR has a failing check.
2. Make failing checks a scoring input with a weight of **0** for now. Wiring it in as a named weight means a future "customizable scoring" change only has to change one value.

## Behavior

### Label

- "Failing" uses the existing `itemHasFailingChecks` predicate (the same one the sidebar **Failing only** filter uses): any `pr.checkRuns[].conclusion === "failure"` or `pr.associatedRuns[].conclusion === "failure"`.
- Main window: the `review` variant of `ActionableRow` renders `<ReasonBadge reason="checks_failing" />` ahead of the team / owner / draft pills.
- Tray: `TrayReviewRow` renders the same pill, and tray PR rows roll their `CheckDot` up across all checks instead of reading `checkRuns[0]`.
- **Not changed:** Needs Action Now membership, the tray badge count, and failing-checks notifications stay limited to PRs I author (SPECS §5/§10 notification budget). A failing review request gets the label in Review Requests; it does not get promoted into Needs Action Now.

### Score

- New constant `CHECKS_FAILING_WEIGHT: i64 = 0` in `src-tauri/src/scoring.rs`, added to the running score when the PR has a failing check run (or associated run, if attached).
- It is applied in the additive phase, before the stale / penalized-bot overwrites.
- Scoring runs inside `fetch_review_requests` after `assemble_review_item` has fetched `check_runs`, so per-commit check runs are available. `associated_runs` are attached later in the poll loop, so in practice the score signal comes from check runs. GitHub Actions jobs show up as check runs on the head SHA, so this covers standard CI.
- Settings → Scoring weights table gains a **Checks failing** row showing `+0`.
- SPECS §6 and the CLAUDE.md scoring block list the new rule.

## Design note

`design/src/main-window.jsx` shows check state on rows via `CheckDot`, not a pill on review rows. This issue intentionally diverges at the product owner's request: it reuses the existing `ReasonBadge` "Checks failing" pill so the signal looks the same on authored and review PRs.

## Acceptance criteria

- [ ] Review-request rows (main window + tray) show **Checks failing** when any check run / associated run concluded `failure`
- [ ] Rows with all-green, pending, or no check data show no pill
- [ ] Tray PR rows derive their `CheckDot` from every check (failure > pending > first check), so the dot never reads green next to a "Checks failing" pill
- [ ] Needs Action Now, the tray badge, and notifications are unchanged for review requests
- [ ] `CHECKS_FAILING_WEIGHT` exists, defaults to 0, and is applied by `score_pull_requests_at` (covered by a Rust test)
- [ ] Settings → Scoring shows the new weight row
- [ ] SPECS §6 + CLAUDE.md updated
- [ ] `npm test`, `npm run lint`, `cargo clippy -D warnings`, `cargo test` pass
