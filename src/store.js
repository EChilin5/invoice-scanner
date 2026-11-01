import Database from 'better-sqlite3';
import fs from 'node:fs';

fs.mkdirSync('data', { recursive: true });
const db = new Database('data/scanner.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS sync_state (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

export function getState(key) {
  return db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key)?.value;
}

export function setState(key, value) {
  db.prepare(
    `INSERT INTO sync_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}