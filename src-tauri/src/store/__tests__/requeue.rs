
use super::*;
use crate::store::db::open_in_memory;

#[test]
fn record_and_count_attempts_round_trips() {
    let conn = open_in_memory().unwrap();
    let pr = "pr:foo/bar#1";
    let sha = "deadbeef";
    assert_eq!(count_attempts(&conn, pr, sha).unwrap(), 0);

    record_attempt(&conn, pr, sha, true).unwrap();
    // attempted_at is part of the PK and uses millisecond precision; in
    // practice attempts are minutes apart but the test fires them back to
    // back, so space them out.
    std::thread::sleep(std::time::Duration::from_millis(2));
    record_attempt(&conn, pr, sha, false).unwrap();
    assert_eq!(count_attempts(&conn, pr, sha).unwrap(), 2);
}

#[test]
fn count_attempts_is_scoped_to_head_sha() {
    // A new push (new head SHA) resets the cap — that's the whole point of
    // keying attempts on (pr_id, head_sha).
    let conn = open_in_memory().unwrap();
    let pr = "pr:foo/bar#1";
    record_attempt(&conn, pr, "sha-old", true).unwrap();
    assert_eq!(count_attempts(&conn, pr, "sha-old").unwrap(), 1);
    assert_eq!(count_attempts(&conn, pr, "sha-new").unwrap(), 0);
}

#[test]
fn opt_out_round_trips_without_burning_the_cap() {
    let conn = open_in_memory().unwrap();
    let pr = "pr:foo/bar#1";
    let sha = "abc";
    assert!(!is_opted_out(&conn, pr, sha).unwrap());

    set_opt_out(&conn, pr, sha, true).unwrap();
    assert!(is_opted_out(&conn, pr, sha).unwrap());
    // Sentinel must not count toward the cap.
    assert_eq!(count_attempts(&conn, pr, sha).unwrap(), 0);

    // Idempotent: setting again is a no-op (INSERT OR REPLACE).
    set_opt_out(&conn, pr, sha, true).unwrap();
    assert!(is_opted_out(&conn, pr, sha).unwrap());

    set_opt_out(&conn, pr, sha, false).unwrap();
    assert!(!is_opted_out(&conn, pr, sha).unwrap());
}

#[test]
fn opt_out_is_scoped_per_pr_and_head_sha() {
    let conn = open_in_memory().unwrap();
    set_opt_out(&conn, "pr:foo/bar#1", "sha-a", true).unwrap();
    assert!(is_opted_out(&conn, "pr:foo/bar#1", "sha-a").unwrap());
    assert!(!is_opted_out(&conn, "pr:foo/bar#1", "sha-b").unwrap());
    assert!(!is_opted_out(&conn, "pr:foo/bar#2", "sha-a").unwrap());
}
