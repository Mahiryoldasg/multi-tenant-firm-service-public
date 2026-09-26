import type Database from 'better-sqlite3';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeEmail } from '../../src/server/auth/email.ts';
import { insertUser } from '../../src/server/modules/platform/users.ts';
import type { Employee } from '../../src/server/tenancy/employees.ts';
import { createTestApp } from '../helpers/app.ts';
import { userTokenFor } from '../helpers/auth.ts';
import { TEST_SEED } from '../helpers/db.ts';

const EMPLOYEES_PATH = '/api/employees';
// The seed runs at the real current time, so employees created at LATER sort after the seed admins.
const LATER = '2999-01-01T00:00:00.000Z';
const DELETED_AT = '2026-09-25T12:00:00.000Z';
const PLATFORM_ADMIN_EMAIL = TEST_SEED.platformAdmin.email;
const FIRST_ADMIN_EMAIL = TEST_SEED.firms[0].adminEmail;
const SECOND_ADMIN_EMAIL = TEST_SEED.firms[1].adminEmail;
const FIRST_MEMBER_EMAIL = 'Member@First.Test';

const UNAUTHORIZED = { error: { code: 'UNAUTHORIZED', message: expect.any(String) } };
const FORBIDDEN = { error: { code: 'FORBIDDEN', message: expect.any(String) } };
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: expect.any(String) } };

let app: Express;
let db: Database.Database;
let firstFirmId: string;
let secondFirmId: string;

beforeEach(async () => {
  ({ app, db } = await createTestApp());
  firstFirmId = firmId('First Test Firm');
  secondFirmId = firmId('Second Test Firm');
});

afterEach(() => {
  if (db.open) db.close();
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

/** Inserts an employee straight into the DB and returns their id. */
function addEmployee(firm: string, email: string, role: Employee['role'] = 'member'): string {
  return insertUser(db, LATER, { firmId: firm, role, email, passwordHash: 'unused' });
}

function softDeleteUser(id: string): void {
  db.prepare('UPDATE users SET deleted_at = @at WHERE id = @id').run({ at: DELETED_AT, id });
}

/** A token for a member of the first firm, created on the first call. */
function firstMemberToken(): string {
  const exists = db
    .prepare('SELECT 1 FROM users WHERE email_normalized = @emailNormalized')
    .get({ emailNormalized: normalizeEmail(FIRST_MEMBER_EMAIL) });
  if (!exists) addEmployee(firstFirmId, FIRST_MEMBER_EMAIL);
  return userTokenFor(db, FIRST_MEMBER_EMAIL);
}

function firstAdminToken(): string {
  return userTokenFor(db, FIRST_ADMIN_EMAIL);
}

function tokenFor(role: Employee['role']): string {
  return role === 'firm_admin' ? firstAdminToken() : firstMemberToken();
}

function getEmployees(path: string, token?: string) {
  const req = request(app).get(`${EMPLOYEES_PATH}${path}`);
  return token === undefined ? req : req.set('Authorization', `Bearer ${token}`);
}

describe('GET /api/employees', () => {
  it.each(['firm_admin', 'member'] as const)(
    "lists the own firm's active employees to a %s, exactly, oldest first",
    async (role) => {
      const token = tokenFor(role);
      const zed = addEmployee(firstFirmId, 'Zed@First.Test', 'firm_admin');
      softDeleteUser(addEmployee(firstFirmId, 'Gone@First.Test'));
      addEmployee(secondFirmId, 'Other@Second.Test');

      const res = await getEmployees('', token);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        employees: [
          { id: userId(FIRST_ADMIN_EMAIL), email: FIRST_ADMIN_EMAIL, role: 'firm_admin' },
          ...(role === 'member'
            ? [{ id: userId(FIRST_MEMBER_EMAIL), email: FIRST_MEMBER_EMAIL, role: 'member' }]
            : []),
          { id: zed, email: 'Zed@First.Test', role: 'firm_admin' },
        ],
      });
    },
  );

  it("lists the other firm's employees only to that firm", async () => {
    addEmployee(firstFirmId, 'Mine@First.Test');
    const other = addEmployee(secondFirmId, 'Other@Second.Test');

    const res = await getEmployees('', userTokenFor(db, SECOND_ADMIN_EMAIL));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      employees: [
        { id: userId(SECOND_ADMIN_EMAIL), email: SECOND_ADMIN_EMAIL, role: 'firm_admin' },
        { id: other, email: 'Other@Second.Test', role: 'member' },
      ],
    });
  });

  it('answers 401 without a token', async () => {
    const res = await getEmployees('');

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it('answers the platform admin 403', async () => {
    const res = await getEmployees('', userTokenFor(db, PLATFORM_ADMIN_EMAIL));

    expect(res.status).toBe(403);
    expect(res.body).toEqual(FORBIDDEN);
  });
});

describe('GET /api/employees/:id', () => {
  it.each(['firm_admin', 'member'] as const)(
    'returns an employee of the own firm to a %s, exactly',
    async (role) => {
      const token = tokenFor(role);
      const zed = addEmployee(firstFirmId, 'Zed@First.Test');

      const res = await getEmployees(`/${zed}`, token);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ employee: { id: zed, email: 'Zed@First.Test', role: 'member' } });
    },
  );

  it.each(['firm_admin', 'member'] as const)('returns the calling %s themselves', async (role) => {
    const token = tokenFor(role);
    const email = role === 'firm_admin' ? FIRST_ADMIN_EMAIL : FIRST_MEMBER_EMAIL;

    const res = await getEmployees(`/${userId(email)}`, token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ employee: { id: userId(email), email, role } });
  });

  it.each([
    { label: "another firm's employee", id: () => userId(SECOND_ADMIN_EMAIL) },
    {
      label: 'a soft-deleted employee',
      id: () => {
        const gone = addEmployee(firstFirmId, 'Gone@First.Test');
        softDeleteUser(gone);
        return gone;
      },
    },
    { label: 'an unknown id', id: () => randomUUID() },
    { label: "the platform admin's id", id: () => userId(PLATFORM_ADMIN_EMAIL) },
    { label: 'a malformed percent-encoded id', id: () => '%E0' },
  ])('answers 404 for $label', async ({ id }) => {
    const res = await getEmployees(`/${id()}`, firstAdminToken());

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });

  it("answers a member 404 for another firm's employee too", async () => {
    const res = await getEmployees(`/${userId(SECOND_ADMIN_EMAIL)}`, firstMemberToken());

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });

  it('answers 401 without a token', async () => {
    const res = await getEmployees(`/${userId(FIRST_ADMIN_EMAIL)}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });
});

describe('the firm-admin write guard', () => {
  /** Every user row, to prove a rejected request changed nothing. */
  function usersSnapshot(): unknown[] {
    return db.prepare('SELECT * FROM users ORDER BY rowid').all();
  }

  function write(method: 'post' | 'patch' | 'delete', path: string, token: string) {
    return request(app)[method](`${EMPLOYEES_PATH}${path}`).set('Authorization', `Bearer ${token}`);
  }

  const VALID_NEW_EMPLOYEE = { email: 'New@First.Test', password: 'new-secret', role: 'member' };

  it.each([
    {
      label: 'POST with a valid body',
      method: 'post' as const,
      path: () => '',
      body: VALID_NEW_EMPLOYEE,
    },
    // Contract §3: a member adding an employee with an invalid body gets 403, not 400.
    {
      label: 'POST with an invalid body',
      method: 'post' as const,
      path: () => '',
      body: { role: 'x' },
    },
    {
      label: 'PATCH of an own-firm employee',
      method: 'patch' as const,
      path: () => `/${userId(FIRST_ADMIN_EMAIL)}`,
      body: { role: 'member' },
    },
    {
      label: 'DELETE of an own-firm employee',
      method: 'delete' as const,
      path: () => `/${userId(FIRST_ADMIN_EMAIL)}`,
    },
    {
      label: "PATCH of another firm's employee with an empty body",
      method: 'patch' as const,
      path: () => `/${userId(SECOND_ADMIN_EMAIL)}`,
      body: {},
    },
    {
      label: "DELETE of another firm's employee",
      method: 'delete' as const,
      path: () => `/${userId(SECOND_ADMIN_EMAIL)}`,
    },
    {
      label: 'PATCH of an unknown id',
      method: 'patch' as const,
      path: () => `/${randomUUID()}`,
      body: {},
    },
    { label: 'DELETE of an unknown id', method: 'delete' as const, path: () => `/${randomUUID()}` },
    { label: 'PATCH of a malformed id', method: 'patch' as const, path: () => '/%E0', body: {} },
    { label: 'DELETE of a malformed id', method: 'delete' as const, path: () => '/%E0' },
    { label: 'DELETE with no id', method: 'delete' as const, path: () => '' },
  ])('answers a member 403 for $label and changes nothing', async ({ method, path, body }) => {
    const token = firstMemberToken();
    const before = usersSnapshot();

    const req = write(method, path(), token);
    const res = await (body === undefined ? req : req.send(body));

    expect(res.status).toBe(403);
    expect(res.body).toEqual(FORBIDDEN);
    expect(usersSnapshot()).toEqual(before);
  });

  // Both stay 404 once the PATCH and DELETE routes exist: the scoped lookup answers before the body.
  it("lets a firm admin through: PATCH of another firm's employee with an empty body is 404", async () => {
    // Contract §3: another firm's employee with an empty body gets 404, not 400.
    const res = await write('patch', `/${userId(SECOND_ADMIN_EMAIL)}`, firstAdminToken()).send({});

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });

  it('lets a firm admin through: DELETE of an unknown id is 404', async () => {
    const res = await write('delete', `/${randomUUID()}`, firstAdminToken());

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });
});

describe('unhandled employee requests', () => {
  it('answers OPTIONS /api/employees with the 404 envelope, not an Allow header', async () => {
    const res = await request(app)
      .options(EMPLOYEES_PATH)
      .set('Authorization', `Bearer ${firstAdminToken()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });

  it('answers a path below an id with the 404 envelope', async () => {
    const res = await getEmployees('/x/y', firstAdminToken());

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });
});
