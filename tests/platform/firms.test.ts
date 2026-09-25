import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/server/auth/password.ts';
import {
  createFirmWithAdmin,
  EMAIL_TAKEN,
  listActiveFirms,
} from '../../src/server/modules/platform/firms.ts';
import { createSeededDatabase } from '../helpers/db.ts';

const EARLIER = '2000-01-01T00:00:00.000Z';
const DELETED_AT = '2026-09-25T12:00:00.000Z';

let db: Database.Database;

beforeEach(async () => {
  db = await createSeededDatabase();
});

afterEach(() => {
  db.close();
});

function rowCounts(): { firms: number; users: number } {
  const count = (sql: string) => db.prepare<[], { n: number }>(sql).get()?.n ?? 0;
  return {
    firms: count('SELECT COUNT(*) AS n FROM firms'),
    users: count('SELECT COUNT(*) AS n FROM users'),
  };
}

function insertFirm(name: string, createdAt: string, deletedAt: string | null = null): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO firms (id, name, created_at, updated_at, deleted_at)
     VALUES (@id, @name, @createdAt, @createdAt, @deletedAt)`,
  ).run({ id, name, createdAt, deletedAt });
  return id;
}

describe('listActiveFirms', () => {
  it('orders by creation time first, then by insertion order', () => {
    // Inserted last but created first.
    insertFirm('Older Firm', EARLIER);

    expect(listActiveFirms(db).map((firm) => firm.name)).toEqual([
      'Older Firm',
      'First Test Firm',
      'Second Test Firm',
    ]);
  });

  it('returns id, name and createdAt only, and skips soft-deleted firms', () => {
    const id = insertFirm('Old Firm', EARLIER);
    insertFirm('Deleted Firm', EARLIER, DELETED_AT);

    const [first, ...rest] = listActiveFirms(db);

    expect(first).toEqual({ id, name: 'Old Firm', createdAt: EARLIER });
    expect(rest.map((firm) => firm.name)).toEqual(['First Test Firm', 'Second Test Firm']);
  });
});

describe('createFirmWithAdmin', () => {
  const NOW = '2026-09-26T09:30:00.000Z';
  const INPUT = { name: 'New Firm', adminEmail: 'New.Admin@Example.Test' };

  it('writes the firm and its first admin with the given time', async () => {
    const adminPasswordHash = await hashPassword('new-admin-secret');

    const created = createFirmWithAdmin(db, NOW, { ...INPUT, adminPasswordHash });

    if (created === EMAIL_TAKEN) throw new Error('Expected a created firm');
    expect(db.prepare('SELECT * FROM firms WHERE id = ?').get(created.firm.id)).toEqual({
      id: created.firm.id,
      name: 'New Firm',
      active_mode_id: null,
      created_at: NOW,
      updated_at: NOW,
      deleted_at: null,
    });
    expect(db.prepare('SELECT * FROM users WHERE id = ?').get(created.admin.id)).toEqual({
      id: created.admin.id,
      firm_id: created.firm.id,
      email: 'New.Admin@Example.Test',
      email_normalized: 'new.admin@example.test',
      password_hash: adminPasswordHash,
      role: 'firm_admin',
      created_at: NOW,
      updated_at: NOW,
      deleted_at: null,
    });
    await expect(verifyPassword('new-admin-secret', adminPasswordHash)).resolves.toBe(true);
  });

  it('returns EMAIL_TAKEN for an active email and writes nothing', () => {
    const before = rowCounts();

    const result = createFirmWithAdmin(db, NOW, {
      ...INPUT,
      adminEmail: ' BOSS@first.test ',
      adminPasswordHash: 'unused',
    });

    expect(result).toBe(EMAIL_TAKEN);
    expect(rowCounts()).toEqual(before);
  });

  it('maps a unique-index clash the pre-check missed to EMAIL_TAKEN and rolls the firm back', () => {
    // Only the firm row is deleted, so its admin stays active in the index but not in the lookup.
    db.prepare("UPDATE firms SET deleted_at = @at WHERE name = 'First Test Firm'").run({
      at: DELETED_AT,
    });
    const before = rowCounts();

    const result = createFirmWithAdmin(db, NOW, {
      ...INPUT,
      adminEmail: 'boss@first.test',
      adminPasswordHash: 'unused',
    });

    expect(result).toBe(EMAIL_TAKEN);
    expect(rowCounts()).toEqual(before);
  });
});
