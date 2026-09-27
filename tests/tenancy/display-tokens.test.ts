import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeEmail } from '../../src/server/auth/email.ts';
import { createTenantScope } from '../../src/server/tenancy/scope.ts';
import { createSeededDatabase, TEST_SEED } from '../helpers/db.ts';
import { NO_BROADCASTS } from '../helpers/scope.ts';

const CREATED_AT = '2999-01-01T00:00:00.000Z';
const DELETED_AT = '2026-09-25T12:00:00.000Z';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let db: Database.Database;
let firstFirmId: string;
let secondFirmId: string;
let firstAdminId: string;
let secondAdminId: string;

beforeEach(async () => {
  db = await createSeededDatabase();
  firstFirmId = firmId('First Test Firm');
  secondFirmId = firmId('Second Test Firm');
  firstAdminId = userId(TEST_SEED.firms[0].adminEmail);
  secondAdminId = userId(TEST_SEED.firms[1].adminEmail);
});

afterEach(() => {
  db.close();
});

function firmId(name: string): string {
  const row = db
    .prepare<{ name: string }, { id: string }>('SELECT id FROM firms WHERE name = @name')
    .get({ name });
  if (!row) throw new Error(`No firm named ${name}`);
  return row.id;
}

function userId(email: string): string {
  const row = db
    .prepare<{ emailNormalized: string }, { id: string }>(
      'SELECT id FROM users WHERE email_normalized = @emailNormalized',
    )
    .get({ emailNormalized: normalizeEmail(email) });
  if (!row) throw new Error(`No user ${email}`);
  return row.id;
}

function tokenRows(): unknown[] {
  return db.prepare('SELECT * FROM display_tokens ORDER BY rowid').all();
}

describe('displayTokens.create', () => {
  it.each([null, '', '  Lobi  ', 'Lobi ekranı'])(
    'records exactly one row of its own firm with the label %j as given',
    (label) => {
      const issued = createTenantScope(db, firstFirmId, NO_BROADCASTS).displayTokens.create(
        CREATED_AT,
        {
          label,
          createdByUserId: firstAdminId,
        },
      );

      expect(issued).toEqual({ id: expect.stringMatching(UUID), firmId: firstFirmId });
      expect(tokenRows()).toEqual([
        {
          id: issued?.id,
          firm_id: firstFirmId,
          label,
          created_by_user_id: firstAdminId,
          created_at: CREATED_AT,
        },
      ]);
    },
  );

  it('gives every token its own id', () => {
    const { displayTokens } = createTenantScope(db, firstFirmId, NO_BROADCASTS);
    const token = { label: null, createdByUserId: firstAdminId };

    const first = displayTokens.create(CREATED_AT, token);
    const second = displayTokens.create(CREATED_AT, token);

    expect(first?.id).not.toBe(second?.id);
    expect(tokenRows()).toHaveLength(2);
  });

  it("writes the other firm's tokens only for that firm", () => {
    const issued = createTenantScope(db, secondFirmId, NO_BROADCASTS).displayTokens.create(
      CREATED_AT,
      {
        label: 'Sahne',
        createdByUserId: secondAdminId,
      },
    );

    expect(issued).toEqual({ id: expect.stringMatching(UUID), firmId: secondFirmId });
    expect(tokenRows()).toEqual([
      expect.objectContaining({ id: issued?.id, firm_id: secondFirmId }),
    ]);
  });

  it('keeps its own firm, id and time when the caller object carries stray keys', () => {
    // A variable, not a fresh literal, so TypeScript lets the extra keys through.
    const withStrayKeys = {
      label: 'Lobi',
      createdByUserId: firstAdminId,
      firmId: secondFirmId,
      id: 'forged-id',
      now: '2000-01-01T00:00:00.000Z',
    };

    const issued = createTenantScope(db, firstFirmId, NO_BROADCASTS).displayTokens.create(
      CREATED_AT,
      withStrayKeys,
    );

    expect(issued).toEqual({ id: expect.stringMatching(UUID), firmId: firstFirmId });
    expect(tokenRows()).toEqual([
      {
        id: issued?.id,
        firm_id: firstFirmId,
        label: 'Lobi',
        created_by_user_id: firstAdminId,
        created_at: CREATED_AT,
      },
    ]);
  });

  it('returns undefined for a soft-deleted firm and writes no row', () => {
    db.prepare('UPDATE firms SET deleted_at = @at WHERE id = @id').run({
      at: DELETED_AT,
      id: firstFirmId,
    });

    const issued = createTenantScope(db, firstFirmId, NO_BROADCASTS).displayTokens.create(
      CREATED_AT,
      {
        label: 'Lobi',
        createdByUserId: firstAdminId,
      },
    );

    expect(issued).toBeUndefined();
    expect(tokenRows()).toEqual([]);
  });
});
