
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
