import Database from "@tauri-apps/plugin-sql";

const DB_URL = "sqlite:beet.db";

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load(DB_URL);
  }
  return dbPromise;
}

export function __resetDbForTests(): void {
  dbPromise = null;
}
