import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listActiveFirms } from '../../src/server/modules/platform/firms.ts';
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
