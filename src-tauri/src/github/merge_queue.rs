//! GitHub merge-queue mutations (#13).
//!
//! Exposes `enqueue_pr`, which wraps GitHub's `enqueuePullRequest` GraphQL
//! mutation — the only mutation Beet issues today. The auto-requeue worker
//! calls this when one of the user's authored PRs has been kicked out of the
//! merge queue by a failing required check.

use crate::error::BeetResult;
use crate::github::client::GithubClient;

const ENQUEUE_MUTATION: &str = r#"
    mutation EnqueuePullRequest($input: EnqueuePullRequestInput!) {
      enqueuePullRequest(input: $input) {
        mergeQueueEntry { position }
      }
    }
"#;

/// Enqueue the given PR (by GraphQL node ID) into its repo's merge queue.
///
/// The mutation's response isn't surfaced — the worker only cares whether the
/// call succeeded. Failure modes (auth, rate limit, GitHub errors) propagate
/// as the usual `BeetError` variants so the cycle's existing error UI fires.
pub async fn enqueue_pr(client: &GithubClient, pr_node_id: &str) -> BeetResult<()> {
    let variables = serde_json::json!({
        "input": { "pullRequestId": pr_node_id },
    });
    let _: serde_json::Value = client
        .beet_post_graphql(ENQUEUE_MUTATION, variables)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::BeetError;
    use wiremock::matchers::{body_partial_json, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn enqueue_pr_posts_node_id_in_input() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/graphql"))
            .and(body_partial_json(serde_json::json!({
                "variables": { "input": { "pullRequestId": "PR_kwDOA" } }
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": { "enqueuePullRequest": { "mergeQueueEntry": { "position": 3 } } }
            })))
            .mount(&server)
            .await;

        let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
        enqueue_pr(&client, "PR_kwDOA").await.unwrap();
    }

    #[tokio::test]
    async fn enqueue_pr_propagates_graphql_errors() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/graphql"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": null,
                "errors": [{ "message": "Pull request not in merge queue" }],
            })))
            .mount(&server)
            .await;

        let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
        let err = enqueue_pr(&client, "PR_kwDOA").await.unwrap_err();
        assert!(matches!(err, BeetError::Github { status: 200, .. }));
    }
}
