
use super::*;
use crate::store::db::open_in_memory;

#[test]
fn mute_crud_round_trip() {
    let conn = open_in_memory().unwrap();
    let db = std::sync::Mutex::new(conn);

    // Add a repo mute.
    {
        let c = db.lock().unwrap();
        c.execute(
                "INSERT OR IGNORE INTO mute_rules (scope, value, created_at) VALUES ('repo', 'owner/foo', '2024-01-01T00:00:00.000Z')",
                [],
            ).unwrap();
    }

    // List returns it.
    let rules: Vec<MuteRule> = {
        let c = db.lock().unwrap();
        let mut stmt = c.prepare("SELECT scope, value FROM mute_rules").unwrap();
        stmt.query_map([], |row| {
            Ok(MuteRule {
                scope: row.get(0)?,
                value: row.get(1)?,
            })
        })
        .unwrap()
        .map(|r| r.unwrap())
        .collect()
    };
    assert_eq!(rules.len(), 1);
    assert_eq!(rules[0].scope, "repo");
    assert_eq!(rules[0].value, "owner/foo");

    // Remove it.
    {
        let c = db.lock().unwrap();
        c.execute(
            "DELETE FROM mute_rules WHERE scope='repo' AND value='owner/foo'",
            [],
        )
        .unwrap();
    }
    let count: i64 = {
        let c = db.lock().unwrap();
        c.query_row("SELECT count(*) FROM mute_rules", [], |r| r.get(0))
            .unwrap()
    };
    assert_eq!(count, 0);
}

#[test]
fn pin_crud_and_has_any_pins() {
    let conn = open_in_memory().unwrap();
    assert!(!has_any_pins(&conn));

    conn.execute(
            "INSERT OR IGNORE INTO pin_rules (value, created_at) VALUES ('owner/repo', '2024-01-01T00:00:00.000Z')",
            [],
        )
        .unwrap();
    assert!(has_any_pins(&conn));

    conn.execute("DELETE FROM pin_rules WHERE value='owner/repo'", [])
        .unwrap();
    assert!(!has_any_pins(&conn));
}
