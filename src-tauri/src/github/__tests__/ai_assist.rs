use super::*;
use crate::store::db::open_in_memory;
use std::sync::Mutex;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn db() -> Db {
    Mutex::new(open_in_memory().unwrap())
}

fn pull(author: &str, body: Option<&str>) -> PullDetail {
    serde_json::from_value(serde_json::json!({
        "title": "t",
        "body": body,
        "html_url": "https://github.com/o/r/pull/7",
        "state": "open",
        "user": { "login": author },
        "head": { "sha": "head1" },
        "additions": 1,
        "deletions": 1,
        "created_at": "2026-09-01T00:00:00Z",
        "updated_at": "2026-09-01T00:00:00Z",
    }))
    .unwrap()
}

fn commit_json(message: &str, name: &str, email: &str, login: Option<&str>) -> serde_json::Value {
    serde_json::json!({
        "commit": { "message": message, "author": { "name": name, "email": email } },
        "author": login.map(|l| serde_json::json!({ "login": l })),
        "committer": login.map(|l| serde_json::json!({ "login": l })),
    })
}

fn commit(message: &str, name: &str, email: &str, login: Option<&str>) -> CommitRow {
    serde_json::from_value(commit_json(message, name, email, login)).unwrap()
}

fn human(message: &str) -> CommitRow {
    commit(message, "Ada", "ada@example.com", Some("ada"))
}

// ---------- detect ----------

#[test]
fn no_signals_is_none() {
    let commits = [human("fix: thing\n\nCo-authored-by: Bob <bob@example.com>")];
    assert_eq!(detect(&pull("ada", Some("plain body")), &commits), None);
}

#[test]
fn claude_co_author_trailer_matches_any_casing() {
    for trailer in [
        "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
        "co-authored-by: Claude <NOREPLY@ANTHROPIC.COM>",
        "  Co-authored-by: Claude <noreply@anthropic.com>",
    ] {
        let commits = [human(&format!("feat: x\n\n{trailer}"))];
        let got = detect(&pull("ada", None), &commits).unwrap();
        assert_eq!(got.tools, vec!["Claude"], "{trailer}");
        assert_eq!(got.sources, vec![AiSource::CommitMessage]);
    }
}

#[test]
fn trailer_names_alone_do_not_match() {
    // A human co-author named Claude must not trip the detector.
    let commits = [human("x\n\nCo-authored-by: Claude Monet <claude@monet.fr>")];
    assert_eq!(detect(&pull("ada", None), &commits), None);
}

#[test]
fn lookalike_noreply_emails_do_not_match() {
    // Humans whose logins end in a tool's name must not trip the detector,
    // whether as a co-author or as the commit author.
    let commits = [
        human("x\n\nCo-authored-by: Acme <12345+acmecopilot@users.noreply.github.com>"),
        commit(
            "y",
            "Acme",
            "12345+acmecopilot@users.noreply.github.com",
            None,
        ),
        commit("z", "Eve", "evil-noreply@anthropic.com", None),
        human("w\n\nCo-authored-by: X <abc+copilot@users.noreply.github.com>"),
    ];
    assert_eq!(detect(&pull("ada", None), &commits), None);
}

#[test]
fn noreply_id_prefix_and_bare_email_both_match() {
    let by_author = [commit(
        "x",
        "Copilot",
        "198982749+Copilot@users.noreply.github.com",
        None,
    )];
    let got = detect(&pull("ada", None), &by_author).unwrap();
    assert_eq!(got.tools, vec!["Copilot"]);
    assert_eq!(got.sources, vec![AiSource::CommitAuthor]);

    let bare = [human("x\n\nCo-authored-by: noreply@anthropic.com")];
    assert_eq!(
        detect(&pull("ada", None), &bare).unwrap().tools,
        vec!["Claude"]
    );
}

#[test]
fn email_outside_a_trailer_line_does_not_match() {
    let commits = [human("docs: mention noreply@anthropic.com in README")];
    assert_eq!(detect(&pull("ada", None), &commits), None);
}

#[test]
fn claude_footer_in_commit_message_or_pr_body() {
    let commits = [human(
        "x\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)",
    )];
    let got = detect(
        &pull(
            "ada",
            Some("Summary\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"),
        ),
        &commits,
    )
    .unwrap();
    assert_eq!(got.tools, vec!["Claude"]);
    assert_eq!(got.sources, vec![AiSource::CommitMessage, AiSource::PrBody]);
}

#[test]
fn copilot_agent_as_pr_and_commit_author() {
    let commits = [commit(
        "Initial plan",
        "copilot-swe-agent[bot]",
        "198982749+Copilot@users.noreply.github.com",
        Some("Copilot"),
    )];
    let got = detect(&pull("Copilot", None), &commits).unwrap();
    assert_eq!(got.tools, vec!["Copilot"]);
    assert_eq!(
        got.sources,
        vec![AiSource::PrAuthor, AiSource::CommitAuthor]
    );
}

#[test]
fn copilot_co_author_trailer() {
    let commits = [human(
        "x\n\nCo-authored-by: Copilot <175728472+Copilot@users.noreply.github.com>",
    )];
    let got = detect(&pull("ada", None), &commits).unwrap();
    assert_eq!(got.tools, vec!["Copilot"]);
}

#[test]
fn cursor_devin_and_codex_bot_logins() {
    for (login, tool) in [
        ("cursor[bot]", "Cursor"),
        ("devin-ai-integration[bot]", "Devin"),
        ("chatgpt-codex-connector[bot]", "Codex"),
    ] {
        let got = detect(&pull(login, None), &[]).unwrap();
        assert_eq!(got.tools, vec![tool]);
        assert_eq!(got.sources, vec![AiSource::PrAuthor]);
    }
}

#[test]
fn cursor_agent_trailer() {
    let commits = [human(
        "x\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>",
    )];
    assert_eq!(
        detect(&pull("ada", None), &commits).unwrap().tools,
        vec!["Cursor"]
    );
}

#[test]
fn aider_author_name_suffix_and_trailer() {
    let by_name = [commit("x", "Ada (aider)", "ada@example.com", None)];
    let got = detect(&pull("ada", None), &by_name).unwrap();
    assert_eq!(got.tools, vec!["Aider"]);
    assert_eq!(got.sources, vec![AiSource::CommitAuthor]);

    let by_trailer = [human(
        "x\n\nCo-authored-by: aider (gpt-5) <noreply@aider.chat>",
    )];
    assert_eq!(
        detect(&pull("ada", None), &by_trailer).unwrap().tools,
        vec!["Aider"]
    );
}

#[test]
fn multiple_tools_keep_table_order_and_dedup_sources() {
    let commits = [
        human("x\n\nCo-authored-by: Copilot <1+Copilot@users.noreply.github.com>"),
        human("y\n\nCo-Authored-By: Claude <noreply@anthropic.com>"),
        human("z\n\nCo-Authored-By: Claude <noreply@anthropic.com>"),
    ];
    let got = detect(&pull("ada", None), &commits).unwrap();
    assert_eq!(got.tools, vec!["Claude", "Copilot"]);
    assert_eq!(got.sources, vec![AiSource::CommitMessage]);
}

#[test]
fn serializes_camel_case_with_snake_case_sources() {
    let got = detect(
        &pull("Copilot", Some("🤖 Generated with [Claude Code]")),
        &[],
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(&got).unwrap(),
        serde_json::json!({ "tools": ["Claude", "Copilot"], "sources": ["pr_author", "pr_body"] })
    );
}

// ---------- fetch_pr_commits / resolve_ai_assist ----------

#[tokio::test]
async fn fetches_first_page_of_commits() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/o/r/pulls/7/commits"))
        .and(query_param("per_page", "100"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!([commit_json(
                "x\n\nCo-Authored-By: Claude <noreply@anthropic.com>",
                "Ada",
                "ada@example.com",
                Some("ada"),
            )])),
        )
        .expect(1)
        .mount(&server)
        .await;

    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let got = resolve_ai_assist(&client, &db, "o", "r", 7, &pull("ada", None))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(got.tools, vec!["Claude"]);
}

#[tokio::test]
async fn non_critical_commit_errors_fall_back_to_pr_signals() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();

    let got = resolve_ai_assist(&client, &db, "o", "r", 7, &pull("Copilot", None))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(got.sources, vec![AiSource::PrAuthor]);

    let none = resolve_ai_assist(&client, &db, "o", "r", 7, &pull("ada", None))
        .await
        .unwrap();
    assert_eq!(none, None);
}

#[tokio::test]
async fn rate_limit_propagates() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(429).insert_header("retry-after", "9"))
        .mount(&server)
        .await;
    let db = db();
    let client = GithubClient::with_base_url("tok", &server.uri()).unwrap();
    let res = resolve_ai_assist(&client, &db, "o", "r", 7, &pull("ada", None)).await;
    assert!(matches!(
        res,
        Err(crate::error::BeetError::RateLimited { .. })
    ));
}
