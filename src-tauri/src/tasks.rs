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
#[path = "__tests__/tasks.rs"]
mod tests;
