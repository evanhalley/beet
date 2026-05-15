//! `resolve_team_members`: resolves `org/slug` team specs to a set of member
//! logins, used by the scoring algorithm. Port of `src/lib/github/teams.ts`.

use crate::github::client::GithubClient;
use crate::github::models::TeamMember;
use crate::store::Db;
use std::collections::HashSet;

/// Resolve every `org/slug` spec to its member logins. A spec that is malformed
/// or fails to fetch contributes nothing — it never aborts the whole resolve,
/// matching the JS behavior.
pub async fn resolve_team_members(
    client: &GithubClient,
    db: &Db,
    teams: &[String],
) -> HashSet<String> {
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
            Err(_) => continue,
        }
    }
    members
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::db::open_in_memory;
    use std::sync::Mutex;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn resolves_members_and_skips_failures() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/orgs/acme/teams/core/members"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("etag", "\"t1\"")
                    .set_body_json(serde_json::json!([
                        { "login": "alice" },
                        { "login": "bob" },
                    ])),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/orgs/acme/teams/missing/members"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        let db: Db = Mutex::new(open_in_memory().unwrap());
        let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
        let members = resolve_team_members(
            &client,
            &db,
            &[
                "acme/core".to_string(),
                "acme/missing".to_string(),
                "malformed".to_string(),
            ],
        )
        .await;

        assert!(members.contains("alice"));
        assert!(members.contains("bob"));
        assert_eq!(members.len(), 2);
    }

    #[tokio::test]
    async fn empty_team_list_resolves_to_empty_set() {
        let db: Db = Mutex::new(open_in_memory().unwrap());
        let client = GithubClient::new("tok").unwrap();
        let members = resolve_team_members(&client, &db, &[]).await;
        assert!(members.is_empty());
    }
}
