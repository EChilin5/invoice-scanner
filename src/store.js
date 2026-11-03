import Database from 'better-sqlite3';
import fs from 'node:fs';

fs.mkdirSync('data', { recursive: true });
const db = new Database('data/scanner.db');

// creates the database with a primary key and value
db.exec(`
  CREATE TABLE IF NOT EXISTS sync_state (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// retrieve specific value
export function getState(key) {
  return db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key)?.value;
}

// adds new value to the database
// if a primary key is duplicated it creates a new constraint on the primary key if updated
export function setState(key, value) {
  db.prepare(
    `INSERT INTO sync_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}