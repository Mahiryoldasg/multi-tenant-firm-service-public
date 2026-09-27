import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTenantScope } from '../../src/server/tenancy/scope.ts';
import { createSeededDatabase } from '../helpers/db.ts';
import { NO_BROADCASTS } from '../helpers/scope.ts';

const SET_AT = '2999-01-01T00:00:00.000Z';
const SET_AGAIN_AT = '2999-01-02T00:00:00.000Z';
const DELETED_AT = '2026-09-25T12:00:00.000Z';

let db: Database.Database;
let firstFirmId: string;
let secondFirmId: string;

beforeEach(async () => {
  db = await createSeededDatabase();
  firstFirmId = firmId('First Test Firm');
  secondFirmId = firmId('Second Test Firm');
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

function firmRow(id: string): Record<string, unknown> {
  const row = db
    .prepare<{ id: string }, Record<string, unknown>>('SELECT * FROM firms WHERE id = @id')
    .get({ id });
  if (!row) throw new Error(`No firm ${id}`);
  return row;
}

function softDeleteFirmRow(id: string): void {
  db.prepare('UPDATE firms SET deleted_at = @at WHERE id = @id').run({ at: DELETED_AT, id });
}

describe('mode.get', () => {
  it('is null for a firm whose mode was never set', () => {
    expect(createTenantScope(db, firstFirmId, NO_BROADCASTS).mode.get()).toBeNull();
  });

  it('returns the stored value exactly, untrimmed', () => {
    const { mode } = createTenantScope(db, firstFirmId, NO_BROADCASTS);
    mode.set(SET_AT, '  Lobby 1  ');

    expect(mode.get()).toBe('  Lobby 1  ');
  });

  it('is null for a soft-deleted firm', () => {
    createTenantScope(db, firstFirmId, NO_BROADCASTS).mode.set(SET_AT, 'lobby');
    softDeleteFirmRow(firstFirmId);

    expect(createTenantScope(db, firstFirmId, NO_BROADCASTS).mode.get()).toBeNull();
  });
});

describe('mode.set', () => {
  it('changes only active_mode_id and updated_at of its own firm row', () => {
    const firstBefore = firmRow(firstFirmId);
    const secondBefore = firmRow(secondFirmId);

    expect(createTenantScope(db, firstFirmId, NO_BROADCASTS).mode.set(SET_AT, 'lobby')).toBe(true);

    expect(firmRow(firstFirmId)).toEqual({
      ...firstBefore,
      active_mode_id: 'lobby',
      updated_at: SET_AT,
    });
    expect(firmRow(secondFirmId)).toEqual(secondBefore);
    expect(createTenantScope(db, secondFirmId, NO_BROADCASTS).mode.get()).toBeNull();
  });

  it('keeps each firm on its own value', () => {
    const first = createTenantScope(db, firstFirmId, NO_BROADCASTS).mode;
    const second = createTenantScope(db, secondFirmId, NO_BROADCASTS).mode;

    first.set(SET_AT, 'lobby');
    second.set(SET_AT, 'stage');

    expect(first.get()).toBe('lobby');
    expect(second.get()).toBe('stage');
  });

  it('accepts the current value again and stamps updated_at again', () => {
    const { mode } = createTenantScope(db, firstFirmId, NO_BROADCASTS);
    mode.set(SET_AT, 'lobby');

    expect(mode.set(SET_AGAIN_AT, 'lobby')).toBe(true);
    expect(firmRow(firstFirmId)).toMatchObject({
      active_mode_id: 'lobby',
      updated_at: SET_AGAIN_AT,
    });
  });

  it('returns false for a soft-deleted firm and changes nothing', () => {
    softDeleteFirmRow(firstFirmId);
    const before = firmRow(firstFirmId);

    expect(createTenantScope(db, firstFirmId, NO_BROADCASTS).mode.set(SET_AT, 'lobby')).toBe(false);
    expect(firmRow(firstFirmId)).toEqual(before);
  });
});
