import { beetGet } from "@/lib/github/octokit";
import { resolveTeamMembers } from "@/lib/github/teams";
import { compileTaskRegex, extractTaskUrls } from "@/lib/tasks";
import { scorePullRequests } from "@/lib/scoring";
import {
  detectEjection,
  getLatestEjectionEvent,
  recordEjectionEvent,
  recordLifecycle,
} from "@/lib/storage/lifecycle";
import type {
  ActionableItem,
  ActionableItemMergeQueue,
  EjectedCheck,
  PrLifecycle,
} from "@/lib/types";

export function parseRepoAndOwnerFromURL(
  url: string,
): { owner: string; repo: string } | null {
  const match =
    url.match(/github\.com\/([^/]+)\/([^/]+)/) ||
    url.match(/repos\/([^/]+)\/([^/]+)/);
  if (match) return { owner: match[1], repo: match[2] };
  return null;
}

interface SearchItem {
  number: number;
  html_url?: string;
  url: string;
}

interface SearchResult {
  items: SearchItem[];
}

interface PullDetail {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed";
  merged?: boolean;
  auto_merge?: unknown | null;
  mergeable_state?: string;
  user: { login: string } | null;
  requested_reviewers: Array<{ login: string }> | null;
  head: { sha: string };
  draft?: boolean;
  additions: number;
  deletions: number;
  created_at: string;
  updated_at: string;
}

interface CommentRow {
  user: { login: string } | null;
}

interface ReviewRow {
  user: { login: string } | null;
  state: string;
}

interface CheckRun {
  name: string;
  conclusion: string | null;
  html_url?: string | null;
}

interface CheckRunsResult {
  check_runs: CheckRun[];
}

const EJECTION_CHECK_CONCLUSIONS = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
]);

/**
 * Counts distinct reviewers whose latest non-pending review state is APPROVED.
 *
 * GitHub returns the full review timeline including superseded events
 * (approve → request changes → approve again). Walk the array in order and
 * let the last non-pending state per user win; if it's APPROVED, the user
 * still counts as an approver.
 */
export function countDistinctApprovers(reviews: ReviewRow[]): number {
  const latestByUser = new Map<string, string>();
  for (const r of reviews) {
    const login = r.user?.login;
    if (!login) continue;
    if (r.state === "PENDING") continue;
    latestByUser.set(login, r.state);
  }
  let n = 0;
  for (const state of latestByUser.values()) {
    if (state === "APPROVED") n += 1;
  }
  return n;
}

export function deriveLifecycle(pull: PullDetail): PrLifecycle {
  if (pull.state === "closed") {
    return pull.merged ? "merged" : "closed";
  }
  if (pull.auto_merge != null) return "merge_queue";
  if ((pull.requested_reviewers || []).length > 0) return "in_review";
  return "open";
}

export async function fetchFailingChecks(
  owner: string,
  repo: string,
  headSha: string,
): Promise<EjectedCheck[]> {
  const { body } = await beetGet<CheckRunsResult>({
    cacheKey: `commit:${owner}/${repo}@${headSha}:check-runs`,
    route: "GET /repos/{owner}/{repo}/commits/{ref}/check-runs",
    params: { owner, repo, ref: headSha },
  });
  return (body.check_runs ?? [])
    .filter((r) => r.conclusion && EJECTION_CHECK_CONCLUSIONS.has(r.conclusion))
    .map((r) => ({
      name: r.name,
      conclusion: r.conclusion as string,
      detailsUrl: r.html_url ?? null,
    }));
}

export interface FetchReviewRequestsOptions {
  username: string;
  teams: string[];
  penalizedBots: string[];
  taskRegex: string;
  showAll: boolean;
}

export async function fetchReviewRequests(
  opts: FetchReviewRequestsOptions,
): Promise<ActionableItem[]> {
  const { username, teams, penalizedBots, taskRegex, showAll } = opts;
  const q = `is:pr is:open review-requested:${username}`;

  const [{ body: search }, teamMembers] = await Promise.all([
    beetGet<SearchResult>({
      cacheKey: `search:review-requested:${username}`,
      route: "GET /search/issues",
      params: { q },
    }),
    resolveTeamMembers(teams),
  ]);

  if (!search.items?.length) return [];

  const compiledRegex = compileTaskRegex(taskRegex);

  // TODO(#8 adaptive polling): bound this fan-out with p-limit. A reviewer on
  // 100 open PRs triggers 300 concurrent requests per poll cycle and will hit
  // GitHub's secondary rate limits.
  const items = await Promise.all(
    search.items.map(async (hit) => {
      const parsed = parseRepoAndOwnerFromURL(hit.html_url || hit.url);
      if (!parsed) return null;
      const { owner, repo } = parsed;
      const num = hit.number;

      try {
        const [{ body: pull }, { body: comments }, { body: reviews }] =
          await Promise.all([
            beetGet<PullDetail>({
              cacheKey: `pr:${owner}/${repo}#${num}:detail`,
              route: "GET /repos/{owner}/{repo}/pulls/{pull_number}",
              params: { owner, repo, pull_number: num },
            }),
            beetGet<CommentRow[]>({
              cacheKey: `pr:${owner}/${repo}#${num}:comments`,
              route: "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
              params: { owner, repo, issue_number: num },
            }),
            beetGet<ReviewRow[]>({
              cacheKey: `pr:${owner}/${repo}#${num}:reviews`,
              route: "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
              params: { owner, repo, pull_number: num },
            }),
          ]);

        if (!pull.user) return null;

        const author = pull.user.login;
        const isReviewRequestedFromMe = (pull.requested_reviewers || []).some(
          (r) => r.login === username,
        );
        const isAuthorOnMyTeam = teamMembers.has(author);
        const iveCommented = comments.some((c) => c.user?.login === username);
        const iveReviewed = reviews.some((r) => r.user?.login === username);
        const iveApproved = reviews.some(
          (r) => r.user?.login === username && r.state === "APPROVED",
        );
        const approvalCount = countDistinctApprovers(reviews);
        const taskUrls = extractTaskUrls(pull.body, compiledRegex);

        const lifecycle = deriveLifecycle(pull);

        const item: ActionableItem = {
          id: `pr:${owner}/${repo}#${num}`,
          kind: "pr",
          title: pull.title,
          url: pull.html_url,
          repoFullName: `${owner}/${repo}`,
          updatedAt: pull.updated_at,
          unread: true,
          dismissedUntilFingerprint: null,
          pr: {
            number: num,
            author,
            isAuthoredByMe: author === username,
            isReviewRequestedFromMe,
            isAuthorOnMyTeam,
            iveCommented,
            iveReviewed,
            iveApproved,
            approvalCount,
            isDraft: Boolean(pull.draft),
            additions: pull.additions,
            deletions: pull.deletions,
            createdAt: pull.created_at,
            lifecycle,
            taskUrls,
            score: 0,
          },
        };
        return item;
      } catch {
        return null;
      }
    }),
  );

  const filtered = items.filter((x): x is ActionableItem => x !== null);
  return scorePullRequests(filtered, showAll, penalizedBots);
}

export interface FetchMyOpenPrsOptions {
  username: string;
  taskRegex: string;
}

export async function fetchMyOpenPrs(
  opts: FetchMyOpenPrsOptions,
): Promise<ActionableItem[]> {
  const { username, taskRegex } = opts;
  const q = `is:pr is:open author:${username}`;

  const { body: search } = await beetGet<SearchResult>({
    cacheKey: `search:author:@me:${username}`,
    route: "GET /search/issues",
    params: { q },
  });

  if (!search.items?.length) return [];

  const compiledRegex = compileTaskRegex(taskRegex);

  const items = await Promise.all(
    search.items.map(async (hit) => {
      const parsed = parseRepoAndOwnerFromURL(hit.html_url || hit.url);
      if (!parsed) return null;
      const { owner, repo } = parsed;
      const num = hit.number;
      const prId = `pr:${owner}/${repo}#${num}`;

      try {
        const [{ body: pull }, { body: comments }, { body: reviews }] =
          await Promise.all([
            beetGet<PullDetail>({
              cacheKey: `pr:${owner}/${repo}#${num}:detail`,
              route: "GET /repos/{owner}/{repo}/pulls/{pull_number}",
              params: { owner, repo, pull_number: num },
            }),
            beetGet<CommentRow[]>({
              cacheKey: `pr:${owner}/${repo}#${num}:comments`,
              route: "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
              params: { owner, repo, issue_number: num },
            }),
            beetGet<ReviewRow[]>({
              cacheKey: `pr:${owner}/${repo}#${num}:reviews`,
              route: "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
              params: { owner, repo, pull_number: num },
            }),
          ]);

        if (!pull.user) return null;

        const lifecycle = deriveLifecycle(pull);
        const ejected = await detectEjection(prId, lifecycle);
        await recordLifecycle(prId, lifecycle);

        let mergeQueue: ActionableItemMergeQueue | undefined;
        // Default to true to match fetchReviewRequests; the fingerprint
        // system in #8 will replace this with real read-state tracking.
        // Ejection forces unread regardless.
        let unread = true;

        if (ejected) {
          const failingChecks = await fetchFailingChecks(
            owner,
            repo,
            pull.head.sha,
          );
          await recordEjectionEvent(prId, pull.head.sha, failingChecks);
          const now = new Date().toISOString();
          mergeQueue = {
            position: null,
            enteredAt: now,
            lastEjectionAt: now,
            ejectedChecks: failingChecks,
          };
          unread = true;
        } else if (lifecycle !== "merge_queue") {
          // Hydrate from the last recorded ejection if the head SHA still
          // matches — this keeps the "Kicked from queue" badge sticky across
          // refetches until the PR re-enters the queue or the head moves.
          const prior = await getLatestEjectionEvent(prId);
          if (prior && prior.headSha === pull.head.sha) {
            mergeQueue = {
              position: null,
              enteredAt: prior.observedAt,
              lastEjectionAt: prior.observedAt,
              ejectedChecks: prior.failingChecks,
            };
          }
        } else {
          // PR is currently in the merge queue — surface that state to the
          // row, but ejectedChecks belongs to the prior ejection cycle (if
          // any) and is not relevant right now.
          mergeQueue = {
            position: null,
            enteredAt: new Date().toISOString(),
          };
        }

        const author = pull.user.login;
        const isReviewRequestedFromMe = (pull.requested_reviewers || []).some(
          (r) => r.login === username,
        );
        const iveCommented = comments.some((c) => c.user?.login === username);
        const iveReviewed = reviews.some((r) => r.user?.login === username);
        const iveApproved = reviews.some(
          (r) => r.user?.login === username && r.state === "APPROVED",
        );
        const approvalCount = countDistinctApprovers(reviews);
        const taskUrls = extractTaskUrls(pull.body, compiledRegex);

        const item: ActionableItem = {
          id: prId,
          kind: "pr",
          title: pull.title,
          url: pull.html_url,
          repoFullName: `${owner}/${repo}`,
          updatedAt: pull.updated_at,
          unread,
          dismissedUntilFingerprint: null,
          pr: {
            number: num,
            author,
            isAuthoredByMe: true,
            isReviewRequestedFromMe,
            isAuthorOnMyTeam: false,
            iveCommented,
            iveReviewed,
            iveApproved,
            approvalCount,
            isDraft: Boolean(pull.draft),
            additions: pull.additions,
            deletions: pull.deletions,
            createdAt: pull.created_at,
            lifecycle,
            mergeQueue,
            taskUrls,
            score: 0,
          },
        };
        return item;
      } catch {
        return null;
      }
    }),
  );

  return items
    .filter((x): x is ActionableItem => x !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
