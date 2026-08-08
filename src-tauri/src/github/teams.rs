//! `resolve_team_members`: resolves `org/slug` team specs to a set of member
//! logins, used by the scoring algorithm. Port of `src/lib/github/teams.ts`.

use crate::error::BeetResult;
use crate::github::client::GithubClient;
use crate::github::models::TeamMember;
use crate::store::Db;
use std::collections::HashSet;

/// Resolve every `org/slug` spec to its member logins.
///
/// Malformed specs and non-critical lookup failures (404s, etc.) contribute
/// nothing and don't abort the whole resolve. **Critical** errors (rate-limit,
/// auth, transient outage) DO propagate — otherwise a 429 on this endpoint
/// would silently produce an empty team set, mis-scoring review requests and
/// hiding rate-limit pressure from the adaptive-backoff path.
pub async fn resolve_team_members(
    client: &GithubClient,
    db: &Db,
    teams: &[String],
) -> BeetResult<HashSet<String>> {
    let mut members = HashSet::new();
    for team_str in teams {
        let parts: Vec<&str> = team_str.split('/').collect();
        if parts.len() != 2 {
            continue;
        }
        let org = parts[0].trim();
        let slug = parts[1].trim();
        if org.is_empty() || slug.is_empty() {
            continue;
        }
        let cache_key = format!("team:{org}/{slug}:members");
        let url = client.url(&format!("/orgs/{org}/teams/{slug}/members"));
        match client
            .beet_get::<Vec<TeamMember>>(db, &cache_key, &url)
            .await
        {
            Ok(res) => {
                for m in res.body {
                    if let Some(login) = m.login {
                        members.insert(login);
                    }
                }
            }
            Err(e) if e.is_critical() => return Err(e),
            Err(_) => continue,
        }
    }
    Ok(members)
}

#[cfg(test)]
#[path = "__tests__/teams.rs"]
mod tests;
