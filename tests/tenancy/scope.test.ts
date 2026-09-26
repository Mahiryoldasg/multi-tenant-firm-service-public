import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeEmail } from '../../src/server/auth/email.ts';
import type { Role } from '../../src/server/auth/tokens.ts';
import { insertUser } from '../../src/server/modules/platform/users.ts';
import { createTenantScope } from '../../src/server/tenancy/scope.ts';
import { createSeededDatabase, TEST_SEED } from '../helpers/db.ts';

// The seed runs at the real current time, so these sort before and after it.
const EARLIER = '2000-01-01T00:00:00.000Z';
const LATER = '2999-01-01T00:00:00.000Z';
const DELETED_AT = '2026-09-25T12:00:00.000Z';
const FIRST_ADMIN_EMAIL = TEST_SEED.firms[0].adminEmail;
const SECOND_ADMIN_EMAIL = TEST_SEED.firms[1].adminEmail;

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

function userId(email: string): string {
  const row = db
    .prepare<{ emailNormalized: string }, { id: string }>(
      'SELECT id FROM users WHERE email_normalized = @emailNormalized',
    )
    .get({ emailNormalized: normalizeEmail(email) });
  if (!row) throw new Error(`No user ${email}`);
  return row.id;
}

function addEmployee(
  firm: string,
  email: string,
  createdAt: string,
  role: Exclude<Role, 'platform_admin'> = 'member',
): string {
  return insertUser(db, createdAt, { firmId: firm, role, email, passwordHash: 'unused' });
}

function softDeleteUser(id: string): void {
  db.prepare('UPDATE users SET deleted_at = @at WHERE id = @id').run({ at: DELETED_AT, id });
}

describe('employees.list', () => {
  it("lists only the firm's active employees, oldest first, with the stored casing", () => {
    const later = addEmployee(firstFirmId, 'Later@First.Test', LATER);
    const earliest = addEmployee(firstFirmId, 'Earliest@First.Test', EARLIER, 'firm_admin');
    softDeleteUser(addEmployee(firstFirmId, 'Gone@First.Test', LATER));
    const other = addEmployee(secondFirmId, 'Other@Second.Test', LATER);

    expect(createTenantScope(db, firstFirmId).employees.list()).toEqual([
      { id: earliest, email: 'Earliest@First.Test', role: 'firm_admin' },
      { id: userId(FIRST_ADMIN_EMAIL), email: FIRST_ADMIN_EMAIL, role: 'firm_admin' },
      { id: later, email: 'Later@First.Test', role: 'member' },
    ]);
    expect(createTenantScope(db, secondFirmId).employees.list()).toEqual([
      { id: userId(SECOND_ADMIN_EMAIL), email: SECOND_ADMIN_EMAIL, role: 'firm_admin' },
      { id: other, email: 'Other@Second.Test', role: 'member' },
    ]);
  });

  it('keeps insertion order for employees created in the same instant', () => {
    const zed = addEmployee(firstFirmId, 'Zed@First.Test', LATER);
    const amy = addEmployee(firstFirmId, 'Amy@First.Test', LATER);

    const ids = createTenantScope(db, firstFirmId)
      .employees.list()
      .map((employee) => employee.id);

    expect(ids).toEqual([userId(FIRST_ADMIN_EMAIL), zed, amy]);
  });

  it('is empty when the firm has no active employee', () => {
    softDeleteUser(userId(FIRST_ADMIN_EMAIL));

    expect(createTenantScope(db, firstFirmId).employees.list()).toEqual([]);
  });
});

describe('employees.findById', () => {
  it('finds an active employee of its own firm', () => {
    const member = addEmployee(firstFirmId, 'Member@First.Test', LATER);

    expect(createTenantScope(db, firstFirmId).employees.findById(member)).toEqual({
      id: member,
      email: 'Member@First.Test',
      role: 'member',
    });
  });

  it('finds nothing outside its own active employees', () => {
    const gone = addEmployee(firstFirmId, 'Gone@First.Test', LATER);
    softDeleteUser(gone);
    const first = createTenantScope(db, firstFirmId).employees;

    expect(first.findById(userId(SECOND_ADMIN_EMAIL))).toBeUndefined();
    expect(first.findById(gone)).toBeUndefined();
    expect(first.findById(userId(TEST_SEED.platformAdmin.email))).toBeUndefined();
    expect(first.findById(randomUUID())).toBeUndefined();
  });

  it("mirrors it for the other firm's scope", () => {
    const second = createTenantScope(db, secondFirmId).employees;

    expect(second.findById(userId(SECOND_ADMIN_EMAIL))).toEqual({
      id: userId(SECOND_ADMIN_EMAIL),
      email: SECOND_ADMIN_EMAIL,
      role: 'firm_admin',
    });
    expect(second.findById(userId(FIRST_ADMIN_EMAIL))).toBeUndefined();
  });
});
