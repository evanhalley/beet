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
#[path = "__tests__/merge_queue.rs"]
mod tests;
