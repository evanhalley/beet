
use crate::store::db::open_in_memory;

#[test]
fn suppress_crud_round_trip() {
    let conn = open_in_memory().unwrap();
    let db = std::sync::Mutex::new(conn);

    // Add a suppression.
    {
        let c = db.lock().unwrap();
        c.execute(
                "INSERT OR IGNORE INTO suppress_rules (item_id, created_at) VALUES ('pr:owner/foo#42', '2024-01-01T00:00:00.000Z')",
                [],
            )
            .unwrap();
    }

    // List returns it.
    let ids: Vec<String> = {
        let c = db.lock().unwrap();
        let mut stmt = c.prepare("SELECT item_id FROM suppress_rules").unwrap();
        stmt.query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    };
    assert_eq!(ids, vec!["pr:owner/foo#42".to_string()]);

    // INSERT OR IGNORE is idempotent — re-adding doesn't duplicate.
    {
        let c = db.lock().unwrap();
        c.execute(
                "INSERT OR IGNORE INTO suppress_rules (item_id, created_at) VALUES ('pr:owner/foo#42', '2024-02-01T00:00:00.000Z')",
                [],
            )
            .unwrap();
        let count: i64 = c
            .query_row("SELECT count(*) FROM suppress_rules", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    // Remove it.
    {
        let c = db.lock().unwrap();
        c.execute(
            "DELETE FROM suppress_rules WHERE item_id='pr:owner/foo#42'",
            [],
        )
        .unwrap();
    }
    let count: i64 = {
        let c = db.lock().unwrap();
        c.query_row("SELECT count(*) FROM suppress_rules", [], |r| r.get(0))
            .unwrap()
    };
    assert_eq!(count, 0);
}
