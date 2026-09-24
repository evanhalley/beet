use super::*;
use crate::github::models::{NotificationSubject, UserRef};
use crate::poller::types::{ActionableItemPr, ActionableKind, PrLifecycle};
use crate::store::db::open_in_memory;
use std::sync::Mutex;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn db() -> Db {
    Mutex::new(open_in_memory().unwrap())
}

fn thread(reason: &str, kind: &str, url: Option<&str>) -> NotificationThread {
    NotificationThread {
        reason: reason.into(),
        subject: NotificationSubject {
            kind: kind.into(),
            url: url.map(Into::into),
        },
    }
}

const PR_URL: &str = "https://api.github.com/repos/acme/api/pulls/42";
const MY_PR_URL: &str = "https://api.github.com/repos/acme/api/pulls/7";

fn comment(id: i64, login: &str) -> FullCommentRow {
    FullCommentRow {
        id,
        user: Some(UserRef {
            login: login.into(),
        }),
        body: Some(format!("comment {id}")),
        created_at: format!("2026-01-01T00:00:{id:02}Z"),
        html_url: format!("https://github.com/acme/api/pull/42#c{id}"),
        in_reply_to_id: None,
        path: None,
    }
}

fn pr_item(id: &str) -> ActionableItem {
    ActionableItem {
        id: id.into(),
        kind: ActionableKind::Pr,
        title: "T".into(),
        url: "u".into(),
        repo_full_name: "acme/api".into(),
        updated_at: "2026-01-01T00:00:00.000Z".into(),
        unread: true,
        dismissed_until_fingerprint: None,
        pr: Some(ActionableItemPr {
            number: 42,
            author: "a".into(),
            body: None,
            is_authored_by_me: false,
            is_review_requested_from_me: true,
            is_author_on_my_team: false,
            ive_commented: false,
            ive_reviewed: false,
            ive_approved: false,
            approval_count: 0,
            is_draft: false,
            additions: 1,
            deletions: 1,
            created_at: "2026-01-01T00:00:00.000Z".into(),
            head_ref: None,
            head_fork_owner: None,
            head_sha: None,
            base_ref: None,
            base_sha: None,
            code_ownership: None,
            lifecycle: PrLifecycle::InReview,
            merge_queue: None,
            task_urls: vec![],
            score: 3,
            reviewers: None,
            check_runs: None,
            associated_runs: None,
            activity: None,
        }),
        run: None,
    }
}

#[test]
fn parses_pr_subject_urls() {
    assert_eq!(
        parse_pr_subject_url(PR_URL),
        Some(("acme".into(), "api".into(), 42))
    );
    assert_eq!(
        parse_pr_subject_url("https://api.github.com/repos/acme/api/issues/42"),
        None
    );
    assert_eq!(
        parse_pr_subject_url("https://api.github.com/repos/acme/api/pulls/42/comments"),
        None
    );
    assert_eq!(parse_pr_subject_url("not a url"), None);
}

#[test]
fn routes_each_reason() {
    let issue_url = "https://api.github.com/repos/acme/api/issues/7";
    let threads = vec![
        thread("mention", "PullRequest", Some(PR_URL)),
        thread("team_mention", "PullRequest", Some(PR_URL)),
        thread("comment", "PullRequest", Some(PR_URL)),
        thread("comment", "Issue", Some(issue_url)),
        thread("mention", "Issue", Some(issue_url)),
        thread("review_requested", "PullRequest", Some(PR_URL)),
        thread("author", "PullRequest", Some(MY_PR_URL)),
        thread("state_change", "PullRequest", Some(PR_URL)),
        thread("mention", "PullRequest", None),
    ];
    let routed = route_notifications(&threads);
    let mention = NotificationEvent::Mention {
        pr_id: "pr:acme/api#42".into(),
    };
    assert_eq!(routed.events, vec![mention.clone(), mention]);
    // `comment` on someone else's PR and `author` on my own PR both need
    // the review-comments lookup.
    assert_eq!(
        routed.comment_candidates,
        vec![
            CommentCandidate {
                pr_id: "pr:acme/api#42".into(),
                owner: "acme".into(),
                repo: "api".into(),
                number: 42,
            },
            CommentCandidate {
                pr_id: "pr:acme/api#7".into(),
                owner: "acme".into(),
                repo: "api".into(),
                number: 7,
            },
        ]
    );
}

fn reply(id: i64, login: &str, root: i64) -> FullCommentRow {
    FullCommentRow {
        in_reply_to_id: Some(root),
        ..comment(id, login)
    }
}

#[test]
fn reply_to_my_review_heuristic() {
    // Someone replied on a thread I started.
    assert!(is_reply_to_my_review(
        &[comment(1, "evan"), reply(2, "rina", 1)],
        "evan"
    ));
    // Someone replied after I replied on their thread; login match is
    // case-insensitive.
    assert!(is_reply_to_my_review(
        &[comment(1, "kai"), reply(2, "Evan", 1), reply(3, "kai", 1)],
        "evan"
    ));
    // I'm the newest in the thread — nothing new for me.
    assert!(!is_reply_to_my_review(
        &[comment(1, "rina"), reply(2, "evan", 1)],
        "evan"
    ));
    // A reply on a thread I never joined doesn't count, even though I
    // commented elsewhere on the PR.
    assert!(!is_reply_to_my_review(
        &[comment(1, "evan"), comment(2, "kai"), reply(3, "rina", 2)],
        "evan"
    ));
    // Order-independent: "newest" is by created_at, so the API's
    // updated-desc order (e.g. after I edit my old comment) doesn't matter.
    assert!(is_reply_to_my_review(
        &[comment(1, "evan"), reply(2, "rina", 1)]
            .into_iter()
            .rev()
            .collect::<Vec<_>>(),
        "evan"
    ));
    assert!(!is_reply_to_my_review(
        &[comment(1, "rina"), comment(2, "kai")],
        "evan"
    ));
    assert!(!is_reply_to_my_review(&[], "evan"));
}

#[test]
fn apply_activity_counts_per_pr_and_drops_untracked() {
    let mut items = vec![pr_item("pr:acme/api#42"), pr_item("pr:acme/api#43")];
    let events = vec![
        NotificationEvent::Mention {
            pr_id: "pr:acme/api#42".into(),
        },
        NotificationEvent::Mention {
            pr_id: "pr:acme/api#42".into(),
        },
        NotificationEvent::ReplyToMyReview {
            pr_id: "pr:acme/api#42".into(),
        },
        NotificationEvent::Mention {
            pr_id: "pr:other/repo#1".into(),
        },
    ];
    apply_activity(&mut items, &events);
    assert_eq!(
        items[0].pr.as_ref().unwrap().activity,
        Some(PrActivity {
            mentions_me: 2,
            reply_to_my_review: 1,
        })
    );
    assert_eq!(items[1].pr.as_ref().unwrap().activity, None);
}

#[test]
fn merge_comments_sorts_oldest_first_and_tags_kind() {
    let mut reply = comment(3, "rina");
    reply.in_reply_to_id = Some(2);
    reply.path = Some("src/a.rs".into());
    let merged = merge_comments(
        vec![comment(4, "kai"), comment(1, "kai")],
        vec![comment(2, "evan"), reply],
    );
    let ids: Vec<i64> = merged.iter().map(|c| c.id).collect();
    assert_eq!(ids, vec![1, 2, 3, 4]);
    assert_eq!(merged[0].kind, "issue");
    assert_eq!(merged[1].kind, "review");
    assert_eq!(merged[2].in_reply_to_id, Some(2));
    assert_eq!(merged[2].path.as_deref(), Some("src/a.rs"));
}

#[tokio::test]
async fn fetch_notifications_requests_unread_threads() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/notifications"))
        .and(query_param("all", "false"))
        .and(query_param("participating", "false"))
        .and(query_param("per_page", "100"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!([{
                "id": "100",
                "reason": "mention",
                "updated_at": "2026-01-01T00:00:00Z",
                "unread": true,
                "subject": { "type": "PullRequest", "url": PR_URL, "title": "T" }
            }])),
        )
        .expect(1)
        .mount(&server)
        .await;
    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let threads = fetch_notifications(&client, &db).await.unwrap();
    assert_eq!(threads.len(), 1);
    assert_eq!(threads[0].reason, "mention");
    assert_eq!(threads[0].subject.url.as_deref(), Some(PR_URL));
}

#[tokio::test]
async fn resolve_reply_candidates_only_checks_tracked_prs() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/acme/api/pulls/42/comments"))
        .and(query_param("sort", "updated"))
        .and(query_param("direction", "desc"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            { "id": 2, "user": { "login": "rina" }, "body": "done", "created_at": "2026-01-01T00:00:02Z", "html_url": "h2", "in_reply_to_id": 1 },
            { "id": 1, "user": { "login": "evan" }, "body": "why?", "created_at": "2026-01-01T00:00:01Z", "html_url": "h1" }
        ])))
        .expect(1)
        .mount(&server)
        .await;
    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let candidate = |repo: &str, number: i64| CommentCandidate {
        pr_id: format!("pr:acme/{repo}#{number}"),
        owner: "acme".into(),
        repo: repo.into(),
        number,
    };
    let tracked: HashSet<String> = ["pr:acme/api#42".to_string()].into_iter().collect();
    let events = resolve_reply_candidates(
        &client,
        &db,
        // The duplicate is deduped; the untracked PR is never fetched.
        vec![
            candidate("api", 42),
            candidate("api", 42),
            candidate("web", 9),
        ],
        &tracked,
        "evan",
    )
    .await;
    assert_eq!(
        events,
        vec![NotificationEvent::ReplyToMyReview {
            pr_id: "pr:acme/api#42".into(),
        }]
    );
}

fn comment_rows(n: usize, start: usize) -> serde_json::Value {
    serde_json::Value::Array(
        (start..start + n)
            .map(|i| {
                serde_json::json!({
                    "id": i,
                    "user": { "login": "kai" },
                    "body": format!("c{i}"),
                    "created_at": "2026-01-01T00:00:00Z",
                    "html_url": format!("h{i}"),
                })
            })
            .collect(),
    )
}

#[tokio::test]
async fn fetch_pr_comments_pages_until_a_short_page() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/acme/api/issues/42/comments"))
        .and(query_param("per_page", "100"))
        .and(query_param("page", "1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(comment_rows(100, 1)))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/acme/api/issues/42/comments"))
        .and(query_param("page", "2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(comment_rows(5, 101)))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/acme/api/pulls/42/comments"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
        .expect(1)
        .mount(&server)
        .await;
    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let comments = fetch_pr_comments(&client, &db, "acme", "api", 42)
        .await
        .unwrap();
    // The newest comments (page 2) are included.
    assert_eq!(comments.len(), 105);
    assert!(comments.iter().any(|c| c.id == 105));
}

#[tokio::test]
async fn fetch_pr_comments_merges_issue_and_review_comments() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/acme/api/issues/42/comments"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            { "id": 10, "user": { "login": "kai" }, "body": "hey @evan", "created_at": "2026-01-01T00:00:03Z", "html_url": "h10" }
        ])))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/acme/api/pulls/42/comments"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            { "id": 11, "user": { "login": "evan" }, "body": "nit", "created_at": "2026-01-01T00:00:01Z", "html_url": "h11", "path": "a.rs" }
        ])))
        .mount(&server)
        .await;
    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let comments = fetch_pr_comments(&client, &db, "acme", "api", 42)
        .await
        .unwrap();
    assert_eq!(comments.len(), 2);
    assert_eq!(comments[0].id, 11);
    assert_eq!(comments[0].kind, "review");
    assert_eq!(comments[1].kind, "issue");
    assert_eq!(comments[1].author, "kai");
}
