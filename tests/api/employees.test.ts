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
import { createCapturingLogger } from '../helpers/log.ts';

const EMPLOYEES_PATH = '/api/employees';
// The seed runs at the real current time, so employees created at LATER sort after the seed admins.
const LATER = '2999-01-01T00:00:00.000Z';
const DELETED_AT = '2026-09-25T12:00:00.000Z';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PLATFORM_ADMIN_EMAIL = TEST_SEED.platformAdmin.email;
const FIRST_ADMIN_EMAIL = TEST_SEED.firms[0].adminEmail;
const SECOND_ADMIN_EMAIL = TEST_SEED.firms[1].adminEmail;
const FIRST_MEMBER_EMAIL = 'Member@First.Test';

const UNAUTHORIZED = { error: { code: 'UNAUTHORIZED', message: expect.any(String) } };
const FORBIDDEN = { error: { code: 'FORBIDDEN', message: expect.any(String) } };
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: expect.any(String) } };
const VALIDATION_ERROR = { error: { code: 'VALIDATION_ERROR', message: expect.any(String) } };
const CONFLICT = { error: { code: 'CONFLICT', message: expect.any(String) } };

const NEW_EMPLOYEE = { email: 'New@First.Test', password: 'new-secret', role: 'member' };

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

function createEmployee(body: unknown, token = firstAdminToken()) {
  const req = request(app).post(EMPLOYEES_PATH).set('Authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body as object);
}

function login(email: string, password: string) {
  return request(app).post('/api/auth/login').send({ email, password });
}

function userCount(): number {
  return db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM users').get()?.count ?? 0;
}

function softDeleteFirmRow(id: string): void {
  db.prepare('UPDATE firms SET deleted_at = @at WHERE id = @id').run({ at: DELETED_AT, id });
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

describe('POST /api/employees success', () => {
  it.each(['firm_admin', 'member'] as const)(
    'answers 201 with exactly the new %s, the email trimmed and in the given casing',
    async (role) => {
      const res = await createEmployee({ ...NEW_EMPLOYEE, email: '  New@First.Test  ', role });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        employee: { id: expect.stringMatching(UUID), email: 'New@First.Test', role },
      });
    },
  );

  it("stores the employee in the caller's firm and lists it last", async () => {
    const { body } = await createEmployee(NEW_EMPLOYEE).expect(201);
    const created = { id: body.employee.id, email: 'New@First.Test', role: 'member' };

    const row = db
      .prepare(
        'SELECT firm_id AS firmId, email_normalized AS emailNormalized FROM users WHERE id = ?',
      )
      .get(created.id);
    const list = await getEmployees('', firstAdminToken());
    const one = await getEmployees(`/${created.id}`, firstAdminToken());

    expect(row).toEqual({ firmId: firstFirmId, emailNormalized: 'new@first.test' });
    expect(list.body.employees.at(-1)).toEqual(created);
    expect(one.body).toEqual({ employee: created });
  });

  it('makes an employee who logs in with the untrimmed password and any email casing', async () => {
    await createEmployee({ ...NEW_EMPLOYEE, password: ' spaced secret ' }).expect(201);

    const res = await login('NEW@FIRST.TEST', ' spaced secret ');
    const trimmed = await login('new@first.test', 'spaced secret');

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: expect.stringMatching(UUID),
      email: 'New@First.Test',
      role: 'member',
      firmId: firstFirmId,
    });
    expect(trimmed.status).toBe(401);
  });

  it('reuses the email of a soft-deleted employee', async () => {
    softDeleteUser(addEmployee(secondFirmId, 'new@first.test'));

    const res = await createEmployee(NEW_EMPLOYEE);

    expect(res.status).toBe(201);
  });
});

describe('POST /api/employees failure', () => {
  it('answers 401 without a token', async () => {
    const res = await request(app).post(EMPLOYEES_PATH).send(NEW_EMPLOYEE);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it.each([
    { label: 'no body', body: undefined },
    { label: 'an array body', body: [NEW_EMPLOYEE] },
    { label: 'a missing email', body: { password: 'new-secret', role: 'member' } },
    { label: 'a non-string email', body: { ...NEW_EMPLOYEE, email: 42 } },
    { label: 'a blank email', body: { ...NEW_EMPLOYEE, email: '   ' } },
    { label: 'an email without @', body: { ...NEW_EMPLOYEE, email: 'new.first.test' } },
    { label: 'an email with a space', body: { ...NEW_EMPLOYEE, email: 'new user@first.test' } },
    { label: 'a missing password', body: { email: 'New@First.Test', role: 'member' } },
    { label: 'a non-string password', body: { ...NEW_EMPLOYEE, password: 42 } },
    { label: 'a blank password', body: { ...NEW_EMPLOYEE, password: '   ' } },
    { label: 'a missing role', body: { email: 'New@First.Test', password: 'new-secret' } },
    { label: 'a non-string role', body: { ...NEW_EMPLOYEE, role: 1 } },
    { label: 'a blank role', body: { ...NEW_EMPLOYEE, role: '' } },
    { label: 'a padded role', body: { ...NEW_EMPLOYEE, role: ' member' } },
    { label: 'an unknown role', body: { ...NEW_EMPLOYEE, role: 'bogus' } },
    { label: 'the platform_admin role', body: { ...NEW_EMPLOYEE, role: 'platform_admin' } },
  ])('answers 400 for $label and inserts nothing', async ({ body }) => {
    const before = userCount();

    const res = await createEmployee(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual(VALIDATION_ERROR);
    expect(userCount()).toBe(before);
  });

  it.each([
    { label: 'an own-firm employee', email: '  zed@FIRST.test  ' },
    { label: "the other firm's admin", email: 'BOSS@SECOND.TEST' },
    { label: 'the platform admin', email: 'root@platform.test' },
  ])('answers 409 for the email of $label and inserts nothing', async ({ email }) => {
    addEmployee(firstFirmId, 'Zed@First.Test');
    const before = userCount();

    const res = await createEmployee({ ...NEW_EMPLOYEE, email });

    expect(res.status).toBe(409);
    expect(res.body).toEqual(CONFLICT);
    expect(userCount()).toBe(before);
  });

  it('answers 400, not 409, for an invalid body with a taken email', async () => {
    const res = await createEmployee({ ...NEW_EMPLOYEE, email: SECOND_ADMIN_EMAIL, role: 'bogus' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(VALIDATION_ERROR);
  });

  it('answers 409 from the unique index when the pre-check misses, and inserts nothing', async () => {
    // Only the firm row is deleted, so its admin stays active: the pre-check skips users of deleted
    // firms, but the partial unique index still counts them.
    softDeleteFirmRow(secondFirmId);
    const before = userCount();

    const res = await createEmployee({ ...NEW_EMPLOYEE, email: SECOND_ADMIN_EMAIL });

    expect(res.status).toBe(409);
    expect(res.body).toEqual(CONFLICT);
    expect(userCount()).toBe(before);
  });

  it('lets only one of two overlapping creates with the same email succeed', async () => {
    const before = userCount();

    const [first, second] = await Promise.all([
      createEmployee(NEW_EMPLOYEE),
      createEmployee({ ...NEW_EMPLOYEE, email: 'new@first.test', role: 'firm_admin' }),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(userCount()).toBe(before + 1);
  });
});

describe('POST /api/employees logging', () => {
  it('never writes the password to the log', async () => {
    const { logger, output } = createCapturingLogger();
    const logged = await createTestApp({ logger });
    const token = userTokenFor(logged.db, FIRST_ADMIN_EMAIL);
    const post = (body: object) =>
      request(logged.app).post(EMPLOYEES_PATH).set('Authorization', `Bearer ${token}`).send(body);

    await post({ ...NEW_EMPLOYEE, password: 'secret-for-201' }).expect(201);
    await post({ ...NEW_EMPLOYEE, role: 'bogus', password: 'secret-for-400' }).expect(400);
    await post({ ...NEW_EMPLOYEE, password: 'secret-for-409' }).expect(409);
    logged.db.close();

    expect(output()).toContain('"statusCode":201');
    expect(output()).toContain('"statusCode":400');
    expect(output()).toContain('"statusCode":409');
    expect(output()).not.toContain('secret-for-');
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

  it.each([
    {
      label: 'POST with a valid body',
      method: 'post' as const,
      path: () => '',
      body: NEW_EMPLOYEE,
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
