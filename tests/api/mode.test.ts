import type Database from 'better-sqlite3';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeEmail } from '../../src/server/auth/email.ts';
import { insertUser } from '../../src/server/modules/platform/users.ts';
import { createTestApp, TEST_CONFIG } from '../helpers/app.ts';
import { userTokenFor } from '../helpers/auth.ts';
import { TEST_SEED } from '../helpers/db.ts';

const MODE_PATH = '/api/mode';
const LATER = '2999-01-01T00:00:00.000Z';
const DELETED_AT = '2026-09-25T12:00:00.000Z';
const FIRST_ADMIN_EMAIL = TEST_SEED.firms[0].adminEmail;
const SECOND_ADMIN_EMAIL = TEST_SEED.firms[1].adminEmail;
const FIRST_MEMBER_EMAIL = 'Member@First.Test';

const UNAUTHORIZED = { error: { code: 'UNAUTHORIZED', message: expect.any(String) } };
const FORBIDDEN = { error: { code: 'FORBIDDEN', message: expect.any(String) } };
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: expect.any(String) } };
const VALIDATION_ERROR = { error: { code: 'VALIDATION_ERROR', message: expect.any(String) } };

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

/** The mode stored for a firm, read straight from the DB. */
function storedMode(id: string): string | null | undefined {
  return db
    .prepare<{ id: string }, { modeId: string | null }>(
      'SELECT active_mode_id AS modeId FROM firms WHERE id = @id',
    )
    .get({ id })?.modeId;
}

/** A token for a member of the first firm, created on the first call. */
function firstMemberToken(): string {
  const exists = db
    .prepare('SELECT 1 FROM users WHERE email_normalized = @emailNormalized')
    .get({ emailNormalized: normalizeEmail(FIRST_MEMBER_EMAIL) });
  if (!exists) {
    insertUser(db, LATER, {
      firmId: firstFirmId,
      role: 'member',
      email: FIRST_MEMBER_EMAIL,
      passwordHash: 'unused',
    });
  }
  return userTokenFor(db, FIRST_MEMBER_EMAIL);
}

function firstAdminToken(): string {
  return userTokenFor(db, FIRST_ADMIN_EMAIL);
}

function secondAdminToken(): string {
  return userTokenFor(db, SECOND_ADMIN_EMAIL);
}

function tokenFor(role: 'firm_admin' | 'member'): string {
  return role === 'firm_admin' ? firstAdminToken() : firstMemberToken();
}

function displayToken(): string {
  return jwt.sign({ kind: 'display', firmId: firstFirmId }, TEST_CONFIG.jwtSecret, {
    algorithm: 'HS256',
    jwtid: randomUUID(),
  });
}

function getMode(token?: string) {
  const req = request(app).get(MODE_PATH);
  return token === undefined ? req : req.set('Authorization', `Bearer ${token}`);
}

function setMode(body: unknown, token = firstAdminToken()) {
  const req = request(app).post(MODE_PATH).set('Authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body as object);
}

/** A POST whose body is sent as raw JSON text, for bodies that are not objects. */
function setModeRaw(rawBody: string, token = firstAdminToken()) {
  return request(app)
    .post(MODE_PATH)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .send(rawBody);
}

describe('GET /api/mode', () => {
  it.each(['firm_admin', 'member'] as const)(
    'answers a %s exactly { modeId: null } before any mode is set',
    async (role) => {
      const res = await getMode(tokenFor(role));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ modeId: null });
    },
  );

  it.each(['firm_admin', 'member'] as const)(
    'answers a %s the mode their firm admin set',
    async (role) => {
      await setMode({ modeId: '  Lobby 1  ' });

      const res = await getMode(tokenFor(role));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ modeId: '  Lobby 1  ' });
    },
  );

  it('answers 401 to a soft-deleted admin', async () => {
    const token = firstAdminToken();
    db.prepare("UPDATE users SET deleted_at = @at WHERE email_normalized = 'boss@first.test'").run({
      at: DELETED_AT,
    });

    const res = await getMode(token);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it('answers 401 to an admin of a soft-deleted firm', async () => {
    const token = firstAdminToken();
    db.prepare('UPDATE firms SET deleted_at = @at WHERE id = @id').run({
      at: DELETED_AT,
      id: firstFirmId,
    });

    const res = await getMode(token);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it('answers OPTIONS with the 404 envelope', async () => {
    const res = await request(app)
      .options(MODE_PATH)
      .set('Authorization', `Bearer ${firstAdminToken()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });
});

describe('POST /api/mode', () => {
  it('stores the modeId untrimmed and answers exactly { modeId }', async () => {
    const res = await setMode({ modeId: '  Lobby 1  ' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ modeId: '  Lobby 1  ' });
    expect(storedMode(firstFirmId)).toBe('  Lobby 1  ');
  });

  it("ignores unknown fields, including another firm's id", async () => {
    const res = await setMode({ modeId: 'lobby', firmId: secondFirmId, extra: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ modeId: 'lobby' });
    expect(storedMode(firstFirmId)).toBe('lobby');
    expect(storedMode(secondFirmId)).toBeNull();
  });

  it("changes only the caller's own firm", async () => {
    await setMode({ modeId: 'lobby' });

    expect((await getMode(secondAdminToken())).body).toEqual({ modeId: null });

    await setMode({ modeId: 'stage' }, secondAdminToken());

    expect((await getMode(firstAdminToken())).body).toEqual({ modeId: 'lobby' });
    expect((await getMode(secondAdminToken())).body).toEqual({ modeId: 'stage' });
  });

  it('answers 200 again for the same modeId', async () => {
    const first = await setMode({ modeId: 'lobby' });
    const second = await setMode({ modeId: 'lobby' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ modeId: 'lobby' });
  });

  describe('with an invalid body', () => {
    beforeEach(async () => {
      await setMode({ modeId: 'lobby' });
    });

    it.each([
      { label: 'no modeId', body: {} },
      { label: 'an empty modeId', body: { modeId: '' } },
      { label: 'a blank modeId', body: { modeId: '   ' } },
      { label: 'a number', body: { modeId: 42 } },
      { label: 'null', body: { modeId: null } },
      { label: 'an array', body: { modeId: ['x'] } },
      { label: 'no body at all', body: undefined },
    ])('answers 400 for $label and keeps the stored mode', async ({ body }) => {
      const res = await setMode(body);

      expect(res.status).toBe(400);
      expect(res.body).toEqual(VALIDATION_ERROR);
      expect(storedMode(firstFirmId)).toBe('lobby');
    });

    it.each(['"x"', 'null', '[]'])(
      'answers 400 for the non-object JSON body %s and keeps the stored mode',
      async (rawBody) => {
        const res = await setModeRaw(rawBody);

        expect(res.status).toBe(400);
        expect(res.body).toEqual(VALIDATION_ERROR);
        expect(storedMode(firstFirmId)).toBe('lobby');
      },
    );
  });

  it.each([
    { label: 'a valid body', body: { modeId: 'stage' } },
    { label: 'an invalid body', body: { modeId: '' } },
  ])('answers a member 403, not 400, for $label and keeps the mode', async ({ body }) => {
    const res = await setMode(body, firstMemberToken());

    expect(res.status).toBe(403);
    expect(res.body).toEqual(FORBIDDEN);
    expect(storedMode(firstFirmId)).toBeNull();
  });

  it('answers 403 to a firm admin demoted after their token was issued', async () => {
    const token = firstAdminToken();
    db.prepare("UPDATE users SET role = 'member' WHERE email_normalized = 'boss@first.test'").run();

    const res = await setMode({ modeId: 'lobby' }, token);

    expect(res.status).toBe(403);
    expect(res.body).toEqual(FORBIDDEN);
    expect(storedMode(firstFirmId)).toBeNull();
  });

  it('answers 401, not 400, with no token and an invalid body', async () => {
    const res = await request(app).post(MODE_PATH).send({ modeId: '' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it('answers 401, not 400, with a display token and an invalid body', async () => {
    const res = await setMode({ modeId: '' }, displayToken());

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });
});
