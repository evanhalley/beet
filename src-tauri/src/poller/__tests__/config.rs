
use super::*;

#[test]
fn clamp_interval_bounds() {
    assert_eq!(clamp_interval(1), POLLING_INTERVAL_MIN);
    assert_eq!(clamp_interval(60), 60);
    assert_eq!(clamp_interval(99_999), POLLING_INTERVAL_MAX);
}

#[test]
fn clamp_max_attempts_bounds() {
    assert_eq!(clamp_max_attempts(0), AUTO_REQUEUE_MAX_ATTEMPTS_MIN);
    assert_eq!(clamp_max_attempts(2), 2);
    assert_eq!(clamp_max_attempts(99), AUTO_REQUEUE_MAX_ATTEMPTS_MAX);
}

#[test]
fn string_array_parses_and_filters() {
    let v = serde_json::json!(["a", 2, "b", null]);
    assert_eq!(
        string_array(Some(v)),
        Some(vec!["a".to_string(), "b".to_string()])
    );
    assert_eq!(string_array(None), None);
    assert_eq!(string_array(Some(serde_json::json!("notarray"))), None);
}

#[test]
fn string_array_map_parses_object_of_string_lists() {
    let v = serde_json::json!({
        "foo/bar": ["Deploy", "Release"],
        "baz/qux": [],
        "skipped/non-array": "nope",
    });
    let parsed = string_array_map(Some(v)).unwrap();
    assert_eq!(
        parsed.get("foo/bar").unwrap(),
        &vec!["Deploy".to_string(), "Release".to_string()]
    );
    // Empty array is preserved (caller treats as "no filter for this repo").
    assert_eq!(parsed.get("baz/qux").unwrap(), &Vec::<String>::new());
    // Non-array value is dropped entirely.
    assert!(!parsed.contains_key("skipped/non-array"));
}

#[test]
fn string_array_map_handles_missing_and_non_object() {
    assert!(string_array_map(None).is_none());
    assert!(string_array_map(Some(serde_json::json!("notobj"))).is_none());
    assert!(string_array_map(Some(serde_json::json!([1, 2]))).is_none());
}
