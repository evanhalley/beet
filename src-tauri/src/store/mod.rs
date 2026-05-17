pub mod db;
pub mod etag_cache;
pub mod lifecycle;

/// Shared SQLite handle. Calls are short and synchronous — the lock is never
/// held across an `.await`.
pub type Db = std::sync::Mutex<rusqlite::Connection>;
