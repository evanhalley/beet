import { beetGet } from "@/lib/github/octokit";

interface TeamMember {
  login?: string;
}

export async function resolveTeamMembers(teams: string[]): Promise<Set<string>> {
  const members = new Set<string>();
  if (!teams.length) return members;

  const results = await Promise.all(
    teams.map(async (teamStr) => {
      const parts = teamStr.split("/");
      if (parts.length !== 2) return [] as TeamMember[];
      const org = parts[0].trim();
      const slug = parts[1].trim();
      if (!org || !slug) return [] as TeamMember[];
      try {
        const { body } = await beetGet<TeamMember[]>({
          cacheKey: `team:${org}/${slug}:members`,
          route: "GET /orgs/{org}/teams/{team_slug}/members",
          params: { org, team_slug: slug },
        });
        return body;
      } catch {
        return [] as TeamMember[];
      }
    }),
  );

  for (const list of results) {
    for (const m of list) {
      if (m?.login) members.add(m.login);
    }
  }
  return members;
}
