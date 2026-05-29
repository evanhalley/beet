//! Task-URL extraction. Port of `src/lib/tasks.ts`.
//!
//! Uses `fancy-regex` (not the basic `regex` crate) so user-supplied patterns
//! that came from the JS era — including lookaround and backreferences —
//! still compile. The JS `g` flag is implicit here since `find_iter` is
//! always global; it's accepted from `/pattern/flags` input and ignored.

use fancy_regex::Regex;

pub const DEFAULT_TASK_REGEX: &str = r"https://your-company\.atlassian\.net/browse/[A-Z]+-\d+";

/// Compile a user-supplied task pattern. Accepts a bare pattern or the
/// `/pattern/flags` form (`i`, `m`, `s`, `x` are honored; `g` is ignored).
/// Returns `None` for empty input or an invalid pattern.
pub fn compile_task_regex(input: Option<&str>) -> Option<Regex> {
    let input = input?;
    if input.is_empty() {
        return None;
    }

    let (pattern, flag_chars) = match parse_delimited(input) {
        Some((p, f)) => (p.to_string(), f.to_string()),
        None => (input.to_string(), String::new()),
    };

    // fancy-regex doesn't expose a builder for case-insensitive etc.; the
    // canonical way is to prepend inline flags `(?im)`. Honor the Rust-side
    // flags directly, accept JS-only flags as no-ops, and reject anything
    // else — otherwise `/foo/bar` would slip through `parse_delimited` (all
    // alphabetic) and silently compile as a bare `foo` regex.
    let mut inline = String::new();
    for c in flag_chars.chars() {
        let lower = c.to_ascii_lowercase();
        match lower {
            'i' | 'm' | 's' | 'x' => {
                if !inline.contains(lower) {
                    inline.push(lower);
                }
            }
            // JS-valid flags with no Rust analog or implicit-on semantics:
            // g (always global via find_iter), u (unicode is default),
            // y (sticky), d (indices).
            'g' | 'u' | 'y' | 'd' => {}
            // Anything else is a misparse — JS `new RegExp` would throw.
            _ => return None,
        }
    }
    let full_pattern = if inline.is_empty() {
        pattern
    } else {
        format!("(?{inline}){pattern}")
    };

    Regex::new(&full_pattern).ok()
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
    // fancy-regex's find_iter yields Result<Match, Error>; a per-match error
    // (e.g. backtrack limit) just skips that hit rather than aborting.
    for m in regex.find_iter(body) {
        let Ok(m) = m else { continue };
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
}
