import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { migrate } from './migrations.ts';

/** Opens the SQLite database at `dbPath` (or `:memory:`) with an up-to-date schema. */
export function openDatabase(dbPath: string): Database.Database {
  // better-sqlite3 does not create folders, and a fresh clone has no data/ yet.
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}
