import { beetGet } from "@/lib/github/octokit";
import { resolveTeamMembers } from "@/lib/github/teams";
import { compileTaskRegex, extractTaskUrls } from "@/lib/tasks";
import { scorePullRequests } from "@/lib/scoring";
import type { ActionableItem, PrLifecycle } from "@/lib/types";

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
  user: { login: string } | null;
  requested_reviewers: Array<{ login: string }> | null;
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
        const taskUrls = extractTaskUrls(pull.body, compiledRegex);

        const lifecycle: PrLifecycle =
          (pull.requested_reviewers || []).length > 0 ? "in_review" : "open";

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
