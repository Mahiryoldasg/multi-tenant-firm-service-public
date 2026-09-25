import type Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection.ts';
import { MIGRATIONS } from '../../src/server/db/migrations.ts';

describe('openDatabase', () => {
  let db: Database.Database | undefined;
  let tempDir: string | undefined;

  afterEach(() => {
    // Close before deleting: Windows keeps an open database file locked.
    db?.close();
    db = undefined;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it('creates a missing parent directory and opens the file in WAL mode', () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'mtfs-'));
    const dbPath = path.join(tempDir, 'nested', 'data', 'app.db');

    db = openDatabase(dbPath);

    expect(existsSync(dbPath)).toBe(true);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
  });

  it('enables foreign keys and applies every migration', () => {
    db = openDatabase(':memory:');

    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
  });
});
