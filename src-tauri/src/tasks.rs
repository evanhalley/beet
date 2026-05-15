//! Task-URL extraction. Port of `src/lib/tasks.ts`.
//!
//! JS regexes are implicitly global; the `regex` crate's `find_iter` is always
//! global, so the JS "force the `g` flag" workaround has no Rust equivalent —
//! the `g` flag in `/pattern/flags` input is simply ignored.

use regex::{Regex, RegexBuilder};

pub const DEFAULT_TASK_REGEX: &str =
    r"https://your-company\.atlassian\.net/browse/[A-Z]+-\d+";

/// Compile a user-supplied task pattern. Accepts a bare pattern or the
/// `/pattern/flags` form (`i`, `m`, `s`, `x` are honored; `g` is ignored).
/// Returns `None` for empty input or an invalid pattern.
pub fn compile_task_regex(input: Option<&str>) -> Option<Regex> {
    let input = input?;
    if input.is_empty() {
        return None;
    }

    let (pattern, flags) = match parse_delimited(input) {
        Some((p, f)) => (p, f),
        None => (input, ""),
    };

    let mut builder = RegexBuilder::new(pattern);
    for flag in flags.chars() {
        match flag.to_ascii_lowercase() {
            'i' => {
                builder.case_insensitive(true);
            }
            'm' => {
                builder.multi_line(true);
            }
            's' => {
                builder.dot_matches_new_line(true);
            }
            'x' => {
                builder.ignore_whitespace(true);
            }
            // 'g' (always-global) and any other flag have no `regex`-crate
            // equivalent — ignore rather than fail.
            _ => {}
        }
    }
    builder.build().ok()
}

/// Split `/pattern/flags` into its parts. Returns `None` if `input` is not in
/// that form.
fn parse_delimited(input: &str) -> Option<(&str, &str)> {
    let rest = input.strip_prefix('/')?;
    let last_slash = rest.rfind('/')?;
    let pattern = &rest[..last_slash];
    let flags = &rest[last_slash + 1..];
    if flags.chars().all(|c| c.is_ascii_alphabetic()) {
        Some((pattern, flags))
    } else {
        None
    }
}

/// Return every distinct full-match of `regex` in `body`, in first-seen order.
pub fn extract_task_urls(body: Option<&str>, regex: Option<&Regex>) -> Vec<String> {
    let (body, regex) = match (body, regex) {
        (Some(b), Some(r)) if !b.is_empty() => (b, r),
        _ => return Vec::new(),
    };
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for m in regex.find_iter(body) {
        let s = m.as_str().to_string();
        if seen.insert(s.clone()) {
            out.push(s);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compiles_a_raw_pattern() {
        assert!(compile_task_regex(Some(DEFAULT_TASK_REGEX)).is_some());
    }

    #[test]
    fn accepts_delimited_form_with_flags() {
        let re = compile_task_regex(Some(r"/foo-\d+/i")).unwrap();
        assert!(re.is_match("FOO-12"));
        assert!(re.is_match("foo-12"));
    }

    #[test]
    fn delimited_without_flags_compiles() {
        assert!(compile_task_regex(Some(r"/foo-\d+/")).is_some());
    }

    #[test]
    fn returns_none_on_invalid_pattern() {
        assert!(compile_task_regex(Some("[unterminated")).is_none());
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
}
