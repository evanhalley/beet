
use super::*;

#[test]
fn compiles_a_raw_pattern() {
    assert!(compile_task_regex(Some(DEFAULT_TASK_REGEX)).is_some());
}

#[test]
fn accepts_delimited_form_with_flags() {
    let re = compile_task_regex(Some(r"/foo-\d+/i")).unwrap();
    assert!(re.is_match("FOO-12").unwrap());
    assert!(re.is_match("foo-12").unwrap());
}

#[test]
fn delimited_without_flags_compiles() {
    assert!(compile_task_regex(Some(r"/foo-\d+/")).is_some());
}

#[test]
fn returns_none_on_invalid_pattern() {
    assert!(compile_task_regex(Some("[unterminated")).is_none());
}

/// Regression: previously any all-alphabetic suffix was treated as flags
/// and unknown characters were silently dropped, so `/foo/bar` compiled
/// as `/foo/` and started matching unintended URLs. Now unknown flags
/// reject the whole input, matching JS `new RegExp(..., "bar")` throwing.
#[test]
fn rejects_delimited_form_with_unknown_flags() {
    assert!(compile_task_regex(Some("/foo/bar")).is_none());
    assert!(compile_task_regex(Some(r"/PROJ-\d+/z")).is_none());
}

/// JS-valid flags with no Rust analog are accepted as no-ops so saved
/// patterns from the JS era keep compiling.
#[test]
fn accepts_js_only_flags_as_noops() {
    // `g` is always-global in Rust; `u`/`y`/`d` have no per-cycle effect.
    assert!(compile_task_regex(Some(r"/foo-\d+/giu")).is_some());
    assert!(compile_task_regex(Some(r"/foo-\d+/yd")).is_some());
}

#[test]
fn returns_none_on_empty_or_missing_input() {
    assert!(compile_task_regex(Some("")).is_none());
    assert!(compile_task_regex(None).is_none());
}

#[test]
fn matches_default_urls_and_dedupes() {
    let re = compile_task_regex(Some(DEFAULT_TASK_REGEX)).unwrap();
    let body = "
            see https://your-company.atlassian.net/browse/PROJ-123
            and https://your-company.atlassian.net/browse/PROJ-456
            duplicate https://your-company.atlassian.net/browse/PROJ-123
        ";
    assert_eq!(
        extract_task_urls(Some(body), Some(&re)),
        vec![
            "https://your-company.atlassian.net/browse/PROJ-123".to_string(),
            "https://your-company.atlassian.net/browse/PROJ-456".to_string(),
        ]
    );
}

#[test]
fn returns_empty_for_empty_body_or_no_regex() {
    let re = compile_task_regex(Some(DEFAULT_TASK_REGEX)).unwrap();
    assert!(extract_task_urls(Some(""), Some(&re)).is_empty());
    assert!(extract_task_urls(None, Some(&re)).is_empty());
    assert!(extract_task_urls(Some("anything"), None).is_empty());
    assert!(extract_task_urls(Some("just prose"), Some(&re)).is_empty());
}

/// JS users may have saved patterns with lookaround. The basic `regex`
/// crate rejects these; fancy-regex accepts them, matching JS behavior.
#[test]
fn supports_lookaround_for_js_era_patterns() {
    // Lookbehind: match ticket IDs only when preceded by "PR:".
    let re = compile_task_regex(Some(r"(?<=PR: )[A-Z]+-\d+")).unwrap();
    let out = extract_task_urls(Some("note PR: PROJ-7 elsewhere PROJ-99"), Some(&re));
    assert_eq!(out, vec!["PROJ-7".to_string()]);
}
