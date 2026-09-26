import type Database from 'better-sqlite3';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertUser } from '../../src/server/modules/platform/users.ts';
import { createTestApp, TEST_CONFIG } from '../helpers/app.ts';
import { userTokenFor } from '../helpers/auth.ts';
import { TEST_SEED } from '../helpers/db.ts';
import { createCapturingLogger } from '../helpers/log.ts';

const FIRMS_PATH = '/api/firms';
const DELETED_AT = '2026-09-25T12:00:00.000Z';
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PLATFORM_ADMIN_EMAIL = TEST_SEED.platformAdmin.email;
const FIRST_ADMIN_EMAIL = TEST_SEED.firms[0].adminEmail;

const UNAUTHORIZED = { error: { code: 'UNAUTHORIZED', message: expect.any(String) } };
const FORBIDDEN = { error: { code: 'FORBIDDEN', message: expect.any(String) } };
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: expect.any(String) } };
const VALIDATION_ERROR = { error: { code: 'VALIDATION_ERROR', message: expect.any(String) } };
const CONFLICT = { error: { code: 'CONFLICT', message: expect.any(String) } };

const NEW_FIRM = {
  name: 'New Firm',
  adminEmail: 'New.Admin@Example.Test',
  adminPassword: 'new-admin-secret',
};

let app: Express;
let db: Database.Database;

beforeEach(async () => {
  ({ app, db } = await createTestApp());
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

function softDeleteFirm(name: string): void {
  db.prepare('UPDATE firms SET deleted_at = @at WHERE id = @id').run({
    at: DELETED_AT,
    id: firmId(name),
  });
}

/** A token for the first firm's admin after setting their role in the DB, as a tenant user. */
function tenantToken(role: 'firm_admin' | 'member'): string {
  db.prepare("UPDATE users SET role = @role WHERE email_normalized = 'boss@first.test'").run({
    role,
  });
  return userTokenFor(db, FIRST_ADMIN_EMAIL);
}

function platformAdminToken(): string {
  return userTokenFor(db, PLATFORM_ADMIN_EMAIL);
}

function firmCount(): number {
  return db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM firms').get()?.count ?? 0;
}

function createFirm(body: unknown, token = platformAdminToken()) {
  const req = request(app).post(FIRMS_PATH).set('Authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body as object);
}

function patchFirm(id: string, body: unknown, token = platformAdminToken()) {
  const req = request(app).patch(`${FIRMS_PATH}/${id}`).set('Authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body as object);
}

interface FirmRow {
  name: string;
  created_at: string;
  updated_at: string;
}

function firmRow(id: string): FirmRow | undefined {
  return db
    .prepare<{ id: string }, FirmRow>(
      'SELECT name, created_at, updated_at FROM firms WHERE id = @id',
    )
    .get({ id });
}

describe('firm routes guard', () => {
  it('answers 401 without a token', async () => {
    const res = await request(app).get(FIRMS_PATH);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it('answers 401 for a display token', async () => {
    const token = jwt.sign(
      { kind: 'display', firmId: firmId('First Test Firm') },
      TEST_CONFIG.jwtSecret,
      { algorithm: 'HS256', jwtid: randomUUID() },
    );

    const res = await request(app).get(FIRMS_PATH).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it.each(['firm_admin', 'member'] as const)(
    'answers 403 to a %s on the list and on a subpath with no route',
    async (role) => {
      const token = tenantToken(role);

      const list = await request(app).get(FIRMS_PATH).set('Authorization', `Bearer ${token}`);
      const unknown = await request(app)
        .put(`${FIRMS_PATH}/x/y`)
        .set('Authorization', `Bearer ${token}`);

      expect(list.status).toBe(403);
      expect(list.body).toEqual(FORBIDDEN);
      expect(unknown.status).toBe(403);
      expect(unknown.body).toEqual(FORBIDDEN);
    },
  );

  it('answers the platform admin 404 for a method or subpath with no route', async () => {
    const token = platformAdminToken();

    const method = await request(app).put(FIRMS_PATH).set('Authorization', `Bearer ${token}`);
    const subpath = await request(app)
      .get(`${FIRMS_PATH}/x/y`)
      .set('Authorization', `Bearer ${token}`);

    expect(method.status).toBe(404);
    expect(method.body).toEqual(NOT_FOUND);
    expect(subpath.status).toBe(404);
    expect(subpath.body).toEqual(NOT_FOUND);
  });

  it.each([
    { label: 'the list path', path: () => FIRMS_PATH },
    { label: 'a firm path', path: () => `${FIRMS_PATH}/${firmId('First Test Firm')}` },
  ])('answers OPTIONS on $label with the 404 envelope, not an Allow list', async ({ path }) => {
    const asAdmin = await request(app)
      .options(path())
      .set('Authorization', `Bearer ${platformAdminToken()}`);
    const asTenant = await request(app)
      .options(path())
      .set('Authorization', `Bearer ${tenantToken('firm_admin')}`);

    expect(asAdmin.status).toBe(404);
    expect(asAdmin.body).toEqual(NOT_FOUND);
    expect(asAdmin.headers).not.toHaveProperty('allow');
    expect(asTenant.status).toBe(403);
    expect(asTenant.body).toEqual(FORBIDDEN);
  });

  it('does not guard a path that only starts with the same letters', async () => {
    const res = await request(app)
      .get('/api/firmsx')
      .set('Authorization', `Bearer ${tenantToken('firm_admin')}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });
});

describe('GET /api/firms', () => {
  function listFirms() {
    return request(app).get(FIRMS_PATH).set('Authorization', `Bearer ${platformAdminToken()}`);
  }

  it('lists the seed firms with exactly id, name and createdAt, in insertion order', async () => {
    const res = await listFirms();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      firms: [
        {
          id: firmId('First Test Firm'),
          name: 'First Test Firm',
          createdAt: expect.stringMatching(ISO_UTC),
        },
        {
          id: firmId('Second Test Firm'),
          name: 'Second Test Firm',
          createdAt: expect.stringMatching(ISO_UTC),
        },
      ],
    });
  });

  it('leaves out a soft-deleted firm', async () => {
    softDeleteFirm('First Test Firm');

    const res = await listFirms();

    expect(res.status).toBe(200);
    expect(res.body.firms.map((firm: { name: string }) => firm.name)).toEqual(['Second Test Firm']);
  });

  it('returns an empty list once every firm is deleted', async () => {
    softDeleteFirm('First Test Firm');
    softDeleteFirm('Second Test Firm');

    const res = await listFirms();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ firms: [] });
  });
});

describe('POST /api/firms success', () => {
  it('answers 201 with exactly the firm and its admin, trimmed, in the given casing', async () => {
    const res = await createFirm({
      name: '  New Firm  ',
      adminEmail: '  New.Admin@Example.Test\t',
      adminPassword: NEW_FIRM.adminPassword,
      role: 'platform_admin',
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      firm: { id: expect.stringMatching(UUID), name: 'New Firm' },
      admin: { id: expect.stringMatching(UUID), email: 'New.Admin@Example.Test' },
    });
  });

  it('lists the new firm with its creation time', async () => {
    const created = await createFirm(NEW_FIRM).expect(201);

    const res = await request(app)
      .get(FIRMS_PATH)
      .set('Authorization', `Bearer ${platformAdminToken()}`);

    expect(res.body.firms).toHaveLength(3);
    expect(res.body.firms[2]).toEqual({
      id: created.body.firm.id,
      name: 'New Firm',
      createdAt: expect.stringMatching(ISO_UTC),
    });
  });

  it('makes a firm admin of the new firm who logs in with the untrimmed password', async () => {
    const created = await createFirm({ ...NEW_FIRM, adminPassword: ' spaced secret ' }).expect(201);

    const trimmed = await request(app)
      .post('/api/auth/login')
      .send({ email: 'new.admin@example.test', password: 'spaced secret' });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'new.admin@example.test', password: ' spaced secret ' });
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.token}`);
    const firms = await request(app)
      .get(FIRMS_PATH)
      .set('Authorization', `Bearer ${login.body.token}`);

    expect(trimmed.status).toBe(401);
    expect(login.status).toBe(200);
    expect(me.body).toEqual({
      user: {
        id: created.body.admin.id,
        email: 'New.Admin@Example.Test',
        role: 'firm_admin',
        firmId: created.body.firm.id,
      },
    });
    expect(firms.status).toBe(403);
  });

  it('allows two firms with the same name', async () => {
    await createFirm(NEW_FIRM).expect(201);
    const res = await createFirm({ ...NEW_FIRM, adminEmail: 'other@example.test' });

    expect(res.status).toBe(201);
    expect(firmCount()).toBe(4);
  });

  it('reuses the email of a soft-deleted user', async () => {
    db.prepare("UPDATE users SET deleted_at = @at WHERE email_normalized = 'boss@second.test'").run(
      { at: DELETED_AT },
    );

    const res = await createFirm({ ...NEW_FIRM, adminEmail: 'Boss@Second.Test' });

    expect(res.status).toBe(201);
    expect(res.body.admin.email).toBe('Boss@Second.Test');
  });
});

describe('POST /api/firms failure', () => {
  it('answers 401 without a token', async () => {
    const res = await request(app).post(FIRMS_PATH).send(NEW_FIRM);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it.each(['firm_admin', 'member'] as const)(
    'answers 403 to a %s, even with an invalid body',
    async (role) => {
      const res = await createFirm({}, tenantToken(role));

      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
      expect(firmCount()).toBe(2);
    },
  );

  it.each([
    { label: 'a missing name', body: { ...NEW_FIRM, name: undefined } },
    { label: 'a blank name', body: { ...NEW_FIRM, name: ' \t ' } },
    { label: 'a non-string name', body: { ...NEW_FIRM, name: 42 } },
    { label: 'a missing adminEmail', body: { ...NEW_FIRM, adminEmail: undefined } },
    { label: 'a blank adminEmail', body: { ...NEW_FIRM, adminEmail: '  ' } },
    { label: 'a non-string adminEmail', body: { ...NEW_FIRM, adminEmail: ['a@b'] } },
    { label: 'an adminEmail with a space', body: { ...NEW_FIRM, adminEmail: 'a b@x' } },
    { label: 'an adminEmail without @', body: { ...NEW_FIRM, adminEmail: 'ab.x' } },
    { label: 'an adminEmail without a domain', body: { ...NEW_FIRM, adminEmail: 'a@' } },
    { label: 'a missing adminPassword', body: { ...NEW_FIRM, adminPassword: undefined } },
    { label: 'a blank adminPassword', body: { ...NEW_FIRM, adminPassword: '   ' } },
    { label: 'a non-string adminPassword', body: { ...NEW_FIRM, adminPassword: 123 } },
    { label: 'an array body', body: [NEW_FIRM] },
    { label: 'no body', body: undefined },
  ])('answers 400 VALIDATION_ERROR for $label and creates nothing', async ({ body }) => {
    const res = await createFirm(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual(VALIDATION_ERROR);
    expect(firmCount()).toBe(2);
  });

  it('answers 400, not 409, for an invalid body with a taken email', async () => {
    const res = await createFirm({ ...NEW_FIRM, name: ' ', adminEmail: 'boss@second.test' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(VALIDATION_ERROR);
  });

  it.each([
    { label: "another firm's admin, in other casing", adminEmail: 'BOSS@second.TEST' },
    { label: 'the platform admin, with spaces', adminEmail: ' root@platform.test ' },
  ])('answers 409 for the email of $label and creates no firm', async ({ adminEmail }) => {
    const res = await createFirm({ ...NEW_FIRM, adminEmail });

    expect(res.status).toBe(409);
    expect(res.body).toEqual(CONFLICT);
    expect(firmCount()).toBe(2);
    expect(db.prepare("SELECT 1 FROM firms WHERE name = 'New Firm'").get()).toBeUndefined();
  });

  it('answers 409 from the unique index when the pre-check misses, and leaves no firm', async () => {
    // Only the firm row is deleted, so its admin stays active: the pre-check skips users of deleted
    // firms, but the partial unique index still counts them.
    softDeleteFirm('Second Test Firm');

    const res = await createFirm({ ...NEW_FIRM, adminEmail: 'boss@second.test' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual(CONFLICT);
    expect(firmCount()).toBe(2);
  });

  it('lets only one of two overlapping creates with the same email succeed', async () => {
    const [first, second] = await Promise.all([
      createFirm({ ...NEW_FIRM, name: 'Firm A' }),
      createFirm({ ...NEW_FIRM, name: 'Firm B' }),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(firmCount()).toBe(3);
  });
});

describe('POST /api/firms logging', () => {
  it('never writes the admin password to the log', async () => {
    const { logger, output } = createCapturingLogger();
    const logged = await createTestApp({ logger });
    const token = userTokenFor(logged.db, PLATFORM_ADMIN_EMAIL);
    const post = (body: object) =>
      request(logged.app).post(FIRMS_PATH).set('Authorization', `Bearer ${token}`).send(body);

    await post({ ...NEW_FIRM, adminPassword: 'secret-for-201' }).expect(201);
    await post({ ...NEW_FIRM, name: '', adminPassword: 'secret-for-400' }).expect(400);
    await post({ ...NEW_FIRM, adminPassword: 'secret-for-409' }).expect(409);
    logged.db.close();

    expect(output()).toContain('"statusCode":201');
    expect(output()).toContain('"statusCode":400');
    expect(output()).toContain('"statusCode":409');
    expect(output()).not.toContain('secret-for-');
  });
});

describe('PATCH /api/firms/:id success', () => {
  const OLD_TIME = '2026-01-01T00:00:00.000Z';

  beforeEach(() => {
    // An old creation time, so the test can see updated_at move and created_at stay.
    db.prepare(
      "UPDATE firms SET created_at = @at, updated_at = @at WHERE name = 'First Test Firm'",
    ).run({ at: OLD_TIME });
  });

  it('answers 200 with exactly the renamed firm, trimmed', async () => {
    const id = firmId('First Test Firm');

    const res = await patchFirm(id, { name: '  Renamed Firm  ', id: 'other', createdAt: 'x' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ firm: { id, name: 'Renamed Firm' } });
    expect(firmRow(id)).toEqual({
      name: 'Renamed Firm',
      created_at: OLD_TIME,
      updated_at: expect.stringMatching(ISO_UTC),
    });
    expect(firmRow(id)?.updated_at).not.toBe(OLD_TIME);
  });

  it('shows the new name in the list', async () => {
    const id = firmId('First Test Firm');
    await patchFirm(id, { name: 'Renamed Firm' }).expect(200);

    const res = await request(app)
      .get(FIRMS_PATH)
      .set('Authorization', `Bearer ${platformAdminToken()}`);

    expect(res.body.firms[0]).toEqual({ id, name: 'Renamed Firm', createdAt: OLD_TIME });
  });

  it('accepts the current name', async () => {
    const id = firmId('First Test Firm');

    const res = await patchFirm(id, { name: 'First Test Firm' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ firm: { id, name: 'First Test Firm' } });
  });
});

describe('PATCH /api/firms/:id failure', () => {
  it('answers 401 without a token', async () => {
    const res = await request(app)
      .patch(`${FIRMS_PATH}/${firmId('First Test Firm')}`)
      .send({ name: 'Renamed Firm' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it.each(['firm_admin', 'member'] as const)(
    'answers 403 to a %s, even for an unknown id with an invalid body',
    async (role) => {
      const token = tenantToken(role);

      const own = await patchFirm(firmId('First Test Firm'), { name: 'Renamed Firm' }, token);
      const unknown = await patchFirm(randomUUID(), {}, token);

      expect(own.status).toBe(403);
      expect(own.body).toEqual(FORBIDDEN);
      expect(unknown.status).toBe(403);
      expect(unknown.body).toEqual(FORBIDDEN);
      expect(firmRow(firmId('First Test Firm'))?.name).toBe('First Test Firm');
    },
  );

  it.each([
    { label: 'an unknown id', id: () => randomUUID() },
    { label: 'an id that is not a UUID', id: () => 'not-a-firm' },
    {
      label: 'a soft-deleted firm',
      id: () => {
        softDeleteFirm('First Test Firm');
        return firmId('First Test Firm');
      },
    },
  ])('answers 404 for $label', async ({ id }) => {
    const res = await patchFirm(id(), { name: 'Renamed Firm' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });

  it('answers 404, not 400, for an unknown id with an empty body', async () => {
    const res = await patchFirm(randomUUID(), {});

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });

  it('answers a malformed percent-encoded id with 404, after the role check', async () => {
    const asAdmin = await patchFirm('%E0', { name: 'Renamed Firm' });
    const asTenant = await patchFirm('%E0', { name: 'Renamed Firm' }, tenantToken('firm_admin'));

    expect(asAdmin.status).toBe(404);
    expect(asAdmin.body).toEqual(NOT_FOUND);
    expect(asTenant.status).toBe(403);
    expect(asTenant.body).toEqual(FORBIDDEN);
  });

  it.each([
    { label: 'an empty body', body: {} },
    { label: 'a blank name', body: { name: '   ' } },
    { label: 'a non-string name', body: { name: 42 } },
    { label: 'no body', body: undefined },
  ])('answers 400 VALIDATION_ERROR for $label and keeps the name', async ({ body }) => {
    const id = firmId('First Test Firm');

    const res = await patchFirm(id, body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual(VALIDATION_ERROR);
    expect(firmRow(id)?.name).toBe('First Test Firm');
  });
});

describe('DELETE /api/firms/:id', () => {
  const EARLIER_DELETION = '2026-02-01T00:00:00.000Z';

  function deleteFirm(id: string, token = platformAdminToken()) {
    return request(app).delete(`${FIRMS_PATH}/${id}`).set('Authorization', `Bearer ${token}`);
  }

  function deletedAt(table: 'firms' | 'users', where: string): (string | null)[] {
    return db
      .prepare<[], { deleted_at: string | null }>(`SELECT deleted_at FROM ${table} WHERE ${where}`)
      .all()
      .map((row) => row.deleted_at);
  }

  function addFirstFirmUser(email: string): void {
    insertUser(db, DELETED_AT, {
      firmId: firmId('First Test Firm'),
      role: 'member',
      email,
      passwordHash: 'unused',
    });
  }

  it('answers 204 with no body and drops the firm from the list', async () => {
    const res = await deleteFirm(firmId('First Test Firm'));
    const list = await request(app)
      .get(FIRMS_PATH)
      .set('Authorization', `Bearer ${platformAdminToken()}`);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(list.body.firms.map((firm: { name: string }) => firm.name)).toEqual([
      'Second Test Firm',
    ]);
  });

  it('soft-deletes the firm and its active users at one time, and nothing else', async () => {
    addFirstFirmUser('member@first.test');
    addFirstFirmUser('gone@first.test');
    db.prepare("UPDATE users SET deleted_at = @at WHERE email_normalized = 'gone@first.test'").run({
      at: EARLIER_DELETION,
    });

    await deleteFirm(firmId('First Test Firm')).expect(204);

    const [firmDeletedAt] = deletedAt('firms', "name = 'First Test Firm'");
    expect(firmDeletedAt).toMatch(ISO_UTC);
    expect(
      db.prepare("SELECT updated_at FROM firms WHERE name = 'First Test Firm'").pluck().get(),
    ).toBe(firmDeletedAt);
    expect(
      deletedAt('users', "email_normalized IN ('boss@first.test', 'member@first.test')"),
    ).toEqual([firmDeletedAt, firmDeletedAt]);
    expect(deletedAt('users', "email_normalized = 'gone@first.test'")).toEqual([EARLIER_DELETION]);
    expect(deletedAt('firms', "name = 'Second Test Firm'")).toEqual([null]);
    expect(
      deletedAt('users', "email_normalized IN ('boss@second.test', 'root@platform.test')"),
    ).toEqual([null, null]);
  });

  it("invalidates the deleted firm's users and frees their emails", async () => {
    const oldToken = userTokenFor(db, FIRST_ADMIN_EMAIL);

    await deleteFirm(firmId('First Test Firm')).expect(204);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldToken}`);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: FIRST_ADMIN_EMAIL, password: TEST_SEED.firms[0].adminPassword });
    const reused = await createFirm({ ...NEW_FIRM, adminEmail: FIRST_ADMIN_EMAIL });
    const otherFirm = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${userTokenFor(db, 'boss@second.test')}`);

    expect(me.status).toBe(401);
    expect(me.body).toEqual(UNAUTHORIZED);
    expect(login.status).toBe(401);
    expect(reused.status).toBe(201);
    expect(otherFirm.status).toBe(200);
  });

  it('answers 404 to a repeated delete and to a rename after it', async () => {
    const id = firmId('First Test Firm');
    await deleteFirm(id).expect(204);

    const again = await deleteFirm(id);
    const rename = await patchFirm(id, { name: 'Renamed Firm' });

    expect(again.status).toBe(404);
    expect(again.body).toEqual(NOT_FOUND);
    expect(rename.status).toBe(404);
    expect(rename.body).toEqual(NOT_FOUND);
  });

  it.each([
    { label: 'an unknown id', id: () => randomUUID() },
    { label: 'an id that is not a UUID', id: () => 'not-a-firm' },
    { label: 'a malformed percent-encoded id', id: () => '%E0' },
  ])('answers 404 for $label', async ({ id }) => {
    const res = await deleteFirm(id());

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    expect(firmCount()).toBe(2);
  });

  it('answers 401 without a token', async () => {
    const res = await request(app).delete(`${FIRMS_PATH}/${firmId('First Test Firm')}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it.each(['firm_admin', 'member'] as const)(
    'answers 403 to a %s, even for their own firm or an unknown id',
    async (role) => {
      const token = tenantToken(role);

      const own = await deleteFirm(firmId('First Test Firm'), token);
      const unknown = await deleteFirm(randomUUID(), token);

      expect(own.status).toBe(403);
      expect(own.body).toEqual(FORBIDDEN);
      expect(unknown.status).toBe(403);
      expect(unknown.body).toEqual(FORBIDDEN);
      expect(deletedAt('firms', "name = 'First Test Firm'")).toEqual([null]);
    },
  );
});
