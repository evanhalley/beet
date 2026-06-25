pub mod db;
pub mod etag_cache;
pub mod lifecycle;
pub mod mute_pin;
pub mod notifications;
pub mod requeue;
pub mod runs;
pub mod suppress;

/// Shared SQLite handle. Calls are short and synchronous — the lock is never
/// held across an `.await`.
pub type Db = std::sync::Mutex<rusqlite::Connection>;
