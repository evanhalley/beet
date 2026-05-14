# Merge-queue auto-requeue on check failure

When a PR you authored ejects from the merge queue, automatically re-enqueue it (subject to a retry cap). Treat **all** check failures as retry-worthy — no flaky-check allowlist, no pass/fail history heuristic. The retry cap is the only guardrail.

Tracked as [issue #13](https://github.com/evanhalley/beet/issues/13). This consumes the `pr_ejection_events` table and the `pr.mergeQueue.ejectedChecks` data that issue [#10](https://github.com/evanhalley/beet/issues/10) scaffolded. Builds on [#5](05-my-prs-in-flight.md).

Refs: [SPECS.md §7](../SPECS.md) (merge-queue lifecycle + ejection detection), [§10](../SPECS.md) (notification triggers — auto-requeue is *not* one; this issue is action-not-notification).

## Goal

A PR you authored sits in the merge queue, ejects because one or more required checks failed, and Beet quietly re-enqueues it without user action — up to the configured retry cap per `head_sha`. The user only sees a small "Auto-requeued N times" affordance in the detail pane; if the retry cap is hit, the row stays unread and waits for the user.

## Acceptance criteria

### GraphQL mutation + GitHub layer

- [ ] **`src/lib/github/mergeQueue.ts`** (new) — wraps `enqueuePullRequest` GraphQL mutation. Octokit exposes `octokit.graphql(...)`. Signature: `enqueuePr(owner: string, repo: string, prId: string): Promise<{ success: boolean; error?: string }>`. The mutation requires the PR's **node ID** (not its number), which `pulls.get` returns as `node_id`. Either extend `PullDetail` to capture it, or do a tiny GraphQL lookup.
- [ ] **PAT scope check** — `enqueuePullRequest` needs `write:repo` on the target repo. Surface a friendly error if the PAT doesn't have it (the existing auth scope check in `src/lib/github/auth.ts` should be extended).

### Retry-state table

- [ ] **SQLite migration v4** — `pr_requeue_attempts (pr_id TEXT, head_sha TEXT, attempted_at TEXT, succeeded INTEGER, PRIMARY KEY (pr_id, head_sha, attempted_at))`. Mirror in both `src-tauri/src/lib.rs` and `src/lib/storage/migrations.ts`; the parity test will catch drift.
- [ ] **`src/lib/storage/requeue.ts`** (new) — `recordRequeueAttempt(prId, headSha, succeeded)`, `countAttempts(prId, headSha): Promise<number>`. Used by the worker to enforce the cap.

### Auto-requeue worker

- [ ] **Worker location** — augments `fetchMyOpenPrs` (or a sibling step in `useMyOpenPrs`) so it runs on the same polling cadence as the in-flight list. After items are returned from the fetch, iterate items where `pr.mergeQueue?.ejectedChecks?.length > 0` AND `pr.lifecycle !== "merge_queue"` (i.e. *currently* ejected, not currently queued).
- [ ] **Retry-cap check** — `countAttempts(prId, headSha) >= settings.autoRequeueMaxAttempts` → skip. Default cap: `2`.
- [ ] **Opt-in gate** — `settings.autoRequeueEnabled` (Settings UI). Default: `false` (off). Users must explicitly opt in per the kill-switch requirement.
- [ ] **Per-repo opt-in list** — `settings.autoRequeueRepos: string[]` of `"owner/repo"` strings. If non-empty, only those repos are eligible. If empty, all eligible repos (subject to `autoRequeueEnabled`).
- [ ] **Action** — call `enqueuePr`. On success: `recordRequeueAttempt(prId, headSha, true)`. On failure (mutation error, permission denied, etc): `recordRequeueAttempt(prId, headSha, false)` and surface a UI error banner once per `(prId, headSha)` pair.
- [ ] **Idempotency** — the worker must not auto-requeue the same `(prId, headSha)` more than `autoRequeueMaxAttempts` times across app restarts; that's why retry attempts persist.

### Settings UI

- [ ] **New Settings tab: "Merge Queue"** under the existing tab strip. Three fields:
  - Toggle "Auto re-enqueue PRs that fall out of the merge queue"
  - Number input "Max retry attempts per head SHA" (default 2, range 1–5)
  - Text area "Restrict to repos (one `owner/repo` per line)" — empty = all repos
- [ ] **Persisted via the existing `BeetSettings` plugin-store path** — extend `src/lib/storage/settings.ts` with the three keys + defaults; bump `SETTINGS_VERSION`.

### DetailPane affordance

- [ ] **"Auto-requeued N times" badge** — when `countAttempts(prId, headSha) > 0`, the DetailPane header shows a small `<Pill tone="neutral">Auto-requeued N×</Pill>` next to the lifecycle pill. Sources from a new `useRequeueHistory(prId, headSha)` hook backed by `pr_requeue_attempts`.

### Per-PR override (kill switch)

- [ ] **DetailPane "Don't auto-requeue this PR" toggle** — writes `{ prId, headSha, optOut: true }` into a new lightweight table or extends `pr_requeue_attempts` with an `opt_out` column. The worker honors the override before checking the cap.

## Files to add

```
src/
├── components/
│   └── Settings/
│       └── MergeQueueTab.tsx                ← new tab
├── hooks/
│   └── useRequeueHistory.ts                 ← new
├── lib/
│   ├── github/
│   │   └── mergeQueue.ts                    ← enqueuePr GraphQL wrapper
│   └── storage/
│       ├── migrations.ts                    ← +pr_requeue_attempts table
│       └── requeue.ts                       ← recordRequeueAttempt, countAttempts
└── test/
    └── fixtures/
        └── graphql-enqueue-pr-success.json

src/lib/github/mergeQueue.test.ts            ← new
src/lib/storage/requeue.test.ts              ← new
src/hooks/useMyOpenPrs.test.tsx              ← extended: worker behavior
```

## Dependencies

None beyond the existing `@octokit/graphql` already shipped via `@octokit/rest`.

## Test plan

**Unit (Vitest + MSW)**

- `mergeQueue.test.ts` — MSW handler for the GraphQL endpoint; verify the mutation body shape and node-ID plumbing.
- `requeue.test.ts` — record/count round-trip; per-`(prId, headSha)` cap enforcement.
- `useMyOpenPrs.test.tsx` (extended) — given a fetch result with an ejected item:
  - Worker fires the mutation when settings allow and cap not reached.
  - Worker no-ops when `autoRequeueEnabled` is false.
  - Worker no-ops when retry count >= cap.
  - Worker no-ops when the repo isn't in `autoRequeueRepos` (when that list is non-empty).
  - `recordRequeueAttempt` is called with the right outcome.

**Manual**

- Enable auto-requeue in Settings; restrict to a test repo.
- Use a PR with a known-flaky check; let it eject from the queue.
- Verify Beet re-enqueues it; verify the DetailPane shows "Auto-requeued 1×".
- Force a second eject; verify retry count increments and the cap stops further attempts.

## Out of scope (deferred)

| Concern | Lands in |
|---|---|
| Flaky-check allowlist + pass/fail-history heuristic | Not planned — explicit user decision: treat all check failures as retry-worthy in V1. |
| OS notification on auto-requeue success | Could land alongside #9 if useful, otherwise silent by design. |
| Backoff between attempts | If we see thrash in practice; for V1 the retry cap is sufficient. |

## Notes

- **Why no allowlist?** User decision when filing this issue: "Just assume all failures are flaky and should be retried." The retry cap is the only guardrail — a genuinely broken PR will exhaust its cap (default 2) within minutes and stop retrying.
- **Why opt-in?** Auto-merge-ish behavior on a PAT-authed app is risky enough that V1 ships off-by-default. A user enabling it is making a conscious "I trust my queue" call.
- **Adaptive polling.** This issue assumes #9's adaptive polling lands first or alongside, so in-flight PRs poll fast enough that the requeue happens within minutes of the eject. If #9 is still out, document the polling-interval gap in the PR.
