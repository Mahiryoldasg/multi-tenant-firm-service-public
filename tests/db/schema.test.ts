import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/connection.ts';

const NOW = '2026-09-25T10:00:00.000Z';

function insertFirm(db: Database.Database): string {
  const id = randomUUID();
  db.prepare(
    'INSERT INTO firms (id, name, created_at, updated_at) VALUES (@id, @name, @now, @now)',
  ).run({ id, name: 'Test Firm', now: NOW });
  return id;
}

function insertUser(
  db: Database.Database,
  user: { firmId: string | null; role: string; email?: string },
): string {
  const id = randomUUID();
  const email = user.email ?? `${id}@example.test`;
  db.prepare(
    `INSERT INTO users
       (id, firm_id, email, email_normalized, password_hash, role, created_at, updated_at)
     VALUES (@id, @firmId, @email, @emailNormalized, 'not-a-hash', @role, @now, @now)`,
  ).run({
    id,
    firmId: user.firmId,
    email,
    emailNormalized: email.toLowerCase(),
    role: user.role,
    now: NOW,
  });
  return id;
}

function insertDisplayToken(db: Database.Database, firmId: string, createdByUserId: string): void {
  db.prepare(
    `INSERT INTO display_tokens (id, firm_id, created_by_user_id, created_at)
     VALUES (@id, @firmId, @createdByUserId, @now)`,
  ).run({ id: randomUUID(), firmId, createdByUserId, now: NOW });
}

describe('initial schema', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('is schema version 1', () => {
    expect(db.pragma('user_version', { simple: true })).toBe(1);
  });

  it.each([
    {
      table: 'firms',
      columns: ['id', 'name', 'active_mode_id', 'created_at', 'updated_at', 'deleted_at'],
    },
    {
      table: 'users',
      columns: [
        'id',
        'firm_id',
        'email',
        'email_normalized',
        'password_hash',
        'role',
        'created_at',
        'updated_at',
        'deleted_at',
      ],
    },
    {
      table: 'display_tokens',
      columns: ['id', 'firm_id', 'label', 'created_by_user_id', 'created_at'],
    },
    { table: 'meta', columns: ['key', 'value'] },
  ])('creates $table with the contract columns', ({ table, columns }) => {
    const names = db
      .prepare<[string], { name: string }>('SELECT name FROM pragma_table_info(?) ORDER BY cid')
      .all(table)
      .map((column) => column.name);

    expect(names).toEqual(columns);
  });

  it.each(['firms', 'users', 'display_tokens', 'meta'])(
    'declares the %s primary key NOT NULL',
    (table) => {
      const keys = db
        .prepare<[string], { notnull: number }>(
          'SELECT "notnull" FROM pragma_table_info(?) WHERE pk > 0',
        )
        .all(table);

      expect(keys).toEqual([{ notnull: 1 }]);
    },
  );

  it('rejects a NULL primary key', () => {
    const insert = db.prepare(
      "INSERT INTO firms (id, name, created_at, updated_at) VALUES (NULL, 'Firm', @now, @now)",
    );

    expect(() => insert.run({ now: NOW })).toThrow(/NOT NULL constraint failed: firms\.id/);
  });

  it('accepts a platform_admin without a firm and firm users with one', () => {
    const firmId = insertFirm(db);

    insertUser(db, { firmId: null, role: 'platform_admin' });
    insertUser(db, { firmId, role: 'firm_admin' });
    insertUser(db, { firmId, role: 'member' });

    expect(db.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 3 });
  });

  it('rejects firm users without a firm and a platform_admin with one', () => {
    const firmId = insertFirm(db);

    expect(() => insertUser(db, { firmId: null, role: 'firm_admin' })).toThrow(/CHECK constraint/);
    expect(() => insertUser(db, { firmId: null, role: 'member' })).toThrow(/CHECK constraint/);
    expect(() => insertUser(db, { firmId, role: 'platform_admin' })).toThrow(/CHECK constraint/);
  });

  it('rejects an unknown role', () => {
    const firmId = insertFirm(db);

    expect(() => insertUser(db, { firmId, role: 'owner' })).toThrow(/CHECK constraint/);
  });

  it('rejects a user whose firm does not exist', () => {
    expect(() => insertUser(db, { firmId: randomUUID(), role: 'member' })).toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });

  it('rejects a display token whose firm or creator does not exist', () => {
    const firmId = insertFirm(db);
    const userId = insertUser(db, { firmId, role: 'firm_admin' });

    expect(() => insertDisplayToken(db, randomUUID(), userId)).toThrow(
      /FOREIGN KEY constraint failed/,
    );
    expect(() => insertDisplayToken(db, firmId, randomUUID())).toThrow(
      /FOREIGN KEY constraint failed/,
    );
    expect(() => insertDisplayToken(db, firmId, userId)).not.toThrow();
  });

  it('rejects a second active user with the same normalized email, even in another firm', () => {
    insertUser(db, { firmId: insertFirm(db), role: 'firm_admin', email: 'Admin@Example.test' });

    expect(() =>
      insertUser(db, { firmId: insertFirm(db), role: 'member', email: 'admin@EXAMPLE.test' }),
    ).toThrow(/UNIQUE constraint failed: users\.email_normalized/);
  });

  it("frees a soft-deleted user's email for reuse", () => {
    const firmId = insertFirm(db);
    const userId = insertUser(db, { firmId, role: 'member', email: 'reused@example.test' });
    db.prepare('UPDATE users SET deleted_at = @now WHERE id = @id').run({ now: NOW, id: userId });

    expect(() =>
      insertUser(db, { firmId, role: 'member', email: 'reused@example.test' }),
    ).not.toThrow();
  });
});
