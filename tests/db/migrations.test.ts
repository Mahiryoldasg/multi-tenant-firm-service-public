import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../src/server/db/migrations.ts';

const CREATE_A = 'CREATE TABLE a (id INTEGER PRIMARY KEY)';
const CREATE_B = 'CREATE TABLE b (id INTEGER PRIMARY KEY)';
// Creates a table and then fails, so a test can see whether that partial work was rolled back.
const FAILING = 'CREATE TABLE c (id INTEGER PRIMARY KEY); INSERT INTO missing VALUES (1)';

function tableNames(db: Database.Database): string[] {
  return db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
}

describe('migrate', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('applies pending migrations in order and stores the version', () => {
    expect(migrate(db, [CREATE_A, CREATE_B])).toBe(2);

    expect(db.pragma('user_version', { simple: true })).toBe(2);
    expect(tableNames(db)).toEqual(['a', 'b']);
  });

  it('does nothing when every migration is already applied', () => {
    migrate(db, [CREATE_A, CREATE_B]);

    // Running CREATE_A again would throw "table a already exists".
    expect(migrate(db, [CREATE_A, CREATE_B])).toBe(2);
  });

  it('resumes from the stored version', () => {
    migrate(db, [CREATE_A]);

    expect(migrate(db, [CREATE_A, CREATE_B])).toBe(2);
    expect(tableNames(db)).toEqual(['a', 'b']);
  });

  it('rolls back a failing migration together with its version bump', () => {
    expect(() => migrate(db, [CREATE_A, FAILING])).toThrow();

    expect(db.pragma('user_version', { simple: true })).toBe(1);
    expect(tableNames(db)).toEqual(['a']);
  });
});
