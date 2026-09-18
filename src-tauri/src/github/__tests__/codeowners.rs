use super::*;
use std::collections::HashSet;

fn teams(list: &[&str]) -> HashSet<String> {
    list.iter().map(|s| s.to_string()).collect()
}

fn owners(rules: &[Rule], path: &str) -> Option<Vec<String>> {
    owners_for(rules, path).map(|o| o.to_vec())
}

#[test]
fn last_matching_rule_wins_across_nested_directories() {
    let rules = parse_codeowners("/src/ @a\n/src/lib/ @b\n*.md @c\n");
    assert_eq!(owners(&rules, "src/main.rs"), Some(vec!["@a".into()]));
    assert_eq!(owners(&rules, "src/lib/x.rs"), Some(vec!["@b".into()]));
    assert_eq!(owners(&rules, "src/lib/README.md"), Some(vec!["@c".into()]));
    assert_eq!(owners(&rules, "src/lib/deep/y.rs"), Some(vec!["@b".into()]));
}

#[test]
fn earlier_specific_rule_is_overridden_by_later_broad_rule() {
    let rules = parse_codeowners("/src/lib/ @b\n/src/ @a\n");
    assert_eq!(owners(&rules, "src/lib/x.rs"), Some(vec!["@a".into()]));
}

#[test]
fn rule_with_no_owners_clears_ownership() {
    let rules = parse_codeowners("* @a\n/vendor/\n");
    assert_eq!(owners(&rules, "vendor/x.js"), Some(vec![]));
    assert_eq!(owners(&rules, "src/x.js"), Some(vec!["@a".into()]));
}

#[test]
fn no_rules_means_no_match() {
    let rules = parse_codeowners("");
    assert_eq!(owners(&rules, "anything.rs"), None);
}

#[test]
fn multiple_owners_are_preserved_in_order() {
    let rules = parse_codeowners("*.rs @a @acme/core docs@example.com\n");
    assert_eq!(
        owners(&rules, "x.rs"),
        Some(vec![
            "@a".into(),
            "@acme/core".into(),
            "docs@example.com".into()
        ])
    );
}

#[test]
fn star_matches_at_any_depth_but_not_across_slashes() {
    let rules = parse_codeowners("*.js @a\n");
    assert_eq!(owners(&rules, "a/b/c.js"), Some(vec!["@a".into()]));
    assert_eq!(owners(&rules, "c.js"), Some(vec!["@a".into()]));
    assert_eq!(owners(&rules, "c.jsx"), None);
}

#[test]
fn trailing_star_matches_direct_children_only() {
    let rules = parse_codeowners("docs/* @a\n");
    assert_eq!(owners(&rules, "docs/a.md"), Some(vec!["@a".into()]));
    assert_eq!(owners(&rules, "docs/sub/b.md"), None);
}

#[test]
fn anchored_directory_matches_everything_beneath() {
    let rules = parse_codeowners("/docs/ @a\n");
    assert_eq!(owners(&rules, "docs/a.md"), Some(vec!["@a".into()]));
    assert_eq!(owners(&rules, "docs/sub/b.md"), Some(vec!["@a".into()]));
    assert_eq!(owners(&rules, "x/docs/b.md"), None);
    assert_eq!(owners(&rules, "docs"), None);
}

#[test]
fn unanchored_directory_matches_anywhere() {
    let rules = parse_codeowners("apps/ @a\n");
    assert_eq!(owners(&rules, "apps/web/index.ts"), Some(vec!["@a".into()]));
    assert_eq!(owners(&rules, "x/apps/y"), Some(vec!["@a".into()]));
    assert_eq!(owners(&rules, "x/apps"), None);
}

#[test]
fn unanchored_directory_without_trailing_slash_matches_dir_or_file() {
    let rules = parse_codeowners("apps @a\n");
    assert_eq!(owners(&rules, "x/apps"), Some(vec!["@a".into()]));
    assert_eq!(owners(&rules, "x/apps/y"), Some(vec!["@a".into()]));
}

#[test]
fn pattern_with_middle_slash_is_anchored_to_root() {
    let rules = parse_codeowners("src/lib @a\n");
    assert_eq!(owners(&rules, "src/lib/x.rs"), Some(vec!["@a".into()]));
    assert_eq!(owners(&rules, "src/lib"), Some(vec!["@a".into()]));
    assert_eq!(owners(&rules, "pkg/src/lib/x.rs"), None);
}

#[test]
fn double_star_prefix_matches_at_any_depth() {
    let rules = parse_codeowners("**/logs @a\n");
    assert_eq!(owners(&rules, "logs/x.log"), Some(vec!["@a".into()]));
    assert_eq!(owners(&rules, "build/logs/x.log"), Some(vec!["@a".into()]));
    assert_eq!(owners(&rules, "logs"), Some(vec!["@a".into()]));
}

#[test]
fn double_star_suffix_matches_everything_inside() {
    let rules = parse_codeowners("logs/** @a\n");
    assert_eq!(owners(&rules, "logs/x.log"), Some(vec!["@a".into()]));
    assert_eq!(owners(&rules, "logs/a/b.log"), Some(vec!["@a".into()]));
    assert_eq!(owners(&rules, "logs"), None);
    assert_eq!(owners(&rules, "x/logs/a.log"), None);
}

#[test]
fn double_star_in_the_middle_matches_zero_or_more_segments() {
    let rules = parse_codeowners("a/**/b @a\n");
    assert_eq!(owners(&rules, "a/b"), Some(vec!["@a".into()]));
    assert_eq!(owners(&rules, "a/x/b"), Some(vec!["@a".into()]));
    assert_eq!(owners(&rules, "a/x/y/b"), Some(vec!["@a".into()]));
    assert_eq!(owners(&rules, "a/x/y/b/c.rs"), Some(vec!["@a".into()]));
    assert_eq!(owners(&rules, "a/x/c"), None);
}

#[test]
fn question_mark_matches_exactly_one_character() {
    let rules = parse_codeowners("file?.txt @a\n");
    assert_eq!(owners(&rules, "file1.txt"), Some(vec!["@a".into()]));
    assert_eq!(owners(&rules, "file10.txt"), None);
    assert_eq!(owners(&rules, "file.txt"), None);
}

#[test]
fn anchored_build_logs_directory() {
    let rules = parse_codeowners("/build/logs/ @a\n");
    assert_eq!(owners(&rules, "build/logs/x.log"), Some(vec!["@a".into()]));
    assert_eq!(owners(&rules, "x/build/logs/x.log"), None);
}

#[test]
fn comments_blank_lines_and_whitespace_are_ignored() {
    let rules = parse_codeowners("  # comment\n\n   *.rs   @a   \n\t\n# another\n");
    assert_eq!(rules.len(), 1);
    assert_eq!(owners(&rules, "x.rs"), Some(vec!["@a".into()]));
}

#[test]
fn negation_and_character_ranges_are_skipped_as_invalid() {
    let rules = parse_codeowners("!foo @a\na[bc].js @b\n*.js @c\n");
    assert_eq!(rules.len(), 1);
    assert_eq!(owners(&rules, "abc.js"), Some(vec!["@c".into()]));
    assert_eq!(owners(&rules, "foo"), None);
}

#[test]
fn escaped_hash_is_part_of_the_pattern() {
    let rules = parse_codeowners("\\#foo @a\n");
    assert_eq!(owners(&rules, "#foo"), Some(vec!["@a".into()]));
}

#[test]
fn individual_owner_matches_case_insensitively() {
    let owners = vec!["@Evan".to_string()];
    assert!(is_owned_by(&owners, "evan", &teams(&[])));
    assert!(!is_owned_by(&owners, "evans", &teams(&[])));
}

#[test]
fn team_owner_matches_only_when_user_is_on_the_team() {
    let owners = vec!["@Acme/Core".to_string()];
    assert!(is_owned_by(&owners, "evan", &teams(&["acme/core"])));
    assert!(!is_owned_by(&owners, "evan", &teams(&[])));
    assert!(!is_owned_by(&owners, "evan", &teams(&["acme/other"])));
}

#[test]
fn email_owners_never_match() {
    let owners = vec!["evan@example.com".to_string()];
    assert!(!is_owned_by(&owners, "evan", &teams(&[])));
}

#[test]
fn empty_owner_list_is_not_owned() {
    assert!(!is_owned_by(&[], "evan", &teams(&["acme/core"])));
}
