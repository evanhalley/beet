//! CODEOWNERS parser + matcher.
//!
//! GitHub's CODEOWNERS uses gitignore-style patterns where the **last**
//! matching rule wins. The supported subset is small enough that a hand-rolled
//! matcher beats pulling in a glob crate whose defaults differ from gitignore:
//!
//! - `*` and `?` match within a single path segment (never across `/`).
//! - `**` matches zero or more whole segments; a trailing `/**` matches
//!   everything *inside* a directory (at least one segment).
//! - A leading `/`, or any `/` other than a trailing one, anchors the pattern
//!   to the repo root. Otherwise it floats and may match at any depth.
//! - A trailing `/` restricts the match to a directory and its contents.
//! - `docs/*` matches direct children only (GitHub-documented quirk).
//! - `!` negation and `[ ]` character ranges are unsupported by GitHub; such
//!   lines are skipped as invalid rather than guessed at.
//! - A rule with a pattern but no owners clears ownership for matching paths.

use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rule {
    /// The pattern as written, kept for debugging and tests.
    pub pattern: String,
    /// Raw owner tokens: `@user`, `@org/team`, or an email. Empty = clears.
    pub owners: Vec<String>,
    /// Pattern split on `/`, with the anchoring `/` stripped and a `**`
    /// prepended for floating patterns so matching is uniform.
    segments: Vec<String>,
    /// Trailing `/` — match a directory and its contents, never a file itself.
    dir_only: bool,
    /// Last segment is exactly `*` in an anchored pattern: match direct
    /// children only, not nested descendants.
    direct_children_only: bool,
}

/// A parsed CODEOWNERS file plus where it was found in the repo.
#[derive(Debug, Clone)]
pub struct Codeowners {
    pub path: String,
    pub rules: Vec<Rule>,
}

/// Parse CODEOWNERS text into rules, in file order. Invalid lines are dropped.
pub fn parse_codeowners(text: &str) -> Vec<Rule> {
    text.lines().filter_map(parse_line).collect()
}

fn parse_line(line: &str) -> Option<Rule> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let mut tokens = line.split_whitespace();
    let raw = tokens.next()?;
    // `\#` escapes a literal leading hash in the pattern.
    let raw = raw
        .strip_prefix('\\')
        .filter(|r| r.starts_with('#'))
        .unwrap_or(raw);
    if raw.starts_with('!') || raw.contains('[') || raw.contains(']') {
        return None;
    }
    let owners: Vec<String> = tokens.map(|t| t.to_string()).collect();

    let dir_only = raw.len() > 1 && raw.ends_with('/');
    let body = raw.trim_end_matches('/');
    if body.is_empty() {
        return None;
    }
    let anchored = body.starts_with('/') || body.contains('/');
    let body = body.trim_start_matches('/');
    let mut segments: Vec<String> = body
        .split('/')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    if segments.is_empty() {
        return None;
    }
    let direct_children_only = anchored && segments.last().is_some_and(|s| s == "*");
    if !anchored {
        segments.insert(0, "**".to_string());
    }
    Some(Rule {
        pattern: raw.to_string(),
        owners,
        segments,
        dir_only,
        direct_children_only,
    })
}

/// Owners of `path` under `rules`. Last matching rule wins.
///
/// `None` = no rule matched. `Some(&[])` = a rule matched but declared no
/// owners, which clears ownership set by earlier rules.
pub fn owners_for<'a>(rules: &'a [Rule], path: &str) -> Option<&'a [String]> {
    let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    rules
        .iter()
        .rev()
        .find(|r| rule_matches(r, &segs))
        .map(|r| r.owners.as_slice())
}

/// Does any owner token name `username` directly (case-insensitive) or a team
/// in `teams` (`"org/slug"`, lowercase)? Email owners never match: Beet has no
/// reliable way to map an email to the authenticated login.
pub fn is_owned_by(owners: &[String], username: &str, teams: &HashSet<String>) -> bool {
    owners.iter().any(|o| {
        let Some(handle) = o.strip_prefix('@') else {
            return false;
        };
        if handle.contains('/') {
            teams.contains(&handle.to_ascii_lowercase())
        } else {
            handle.eq_ignore_ascii_case(username)
        }
    })
}

fn rule_matches(rule: &Rule, path: &[&str]) -> bool {
    if path.is_empty() {
        return false;
    }
    if !rule.dir_only && glob_segments(&rule.segments, path) {
        return true;
    }
    if rule.direct_children_only {
        return false;
    }
    // A pattern that names a directory covers everything beneath it: try each
    // proper prefix of the path.
    (1..path.len()).any(|n| glob_segments(&rule.segments, &path[..n]))
}

fn glob_segments(pat: &[String], path: &[&str]) -> bool {
    match pat.first() {
        None => path.is_empty(),
        Some(p) if p == "**" => {
            if pat.len() == 1 {
                // Trailing `/**` — everything *inside*, so at least one segment.
                return !path.is_empty();
            }
            (0..=path.len()).any(|i| glob_segments(&pat[1..], &path[i..]))
        }
        Some(p) => match path.first() {
            Some(seg) if segment_matches(p, seg) => glob_segments(&pat[1..], &path[1..]),
            _ => false,
        },
    }
}

/// Single-segment glob: `*` = any run of chars, `?` = exactly one char.
fn segment_matches(pat: &str, seg: &str) -> bool {
    let p: Vec<char> = pat.chars().collect();
    let s: Vec<char> = seg.chars().collect();
    fn go(p: &[char], s: &[char]) -> bool {
        match p.first() {
            None => s.is_empty(),
            Some('*') => (0..=s.len()).any(|i| go(&p[1..], &s[i..])),
            Some('?') => !s.is_empty() && go(&p[1..], &s[1..]),
            Some(c) => s.first() == Some(c) && go(&p[1..], &s[1..]),
        }
    }
    go(&p, &s)
}

#[cfg(test)]
#[path = "__tests__/codeowners.rs"]
mod tests;
