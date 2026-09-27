import type Database from 'better-sqlite3';
import type { Express } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeEmail } from '../../src/server/auth/email.ts';
import { insertUser } from '../../src/server/modules/platform/users.ts';
import { createTestApp, TEST_CONFIG } from '../helpers/app.ts';
import { userTokenFor } from '../helpers/auth.ts';
import { TEST_SEED } from '../helpers/db.ts';

const DISPLAY_TOKENS_PATH = '/api/display-tokens';
const LATER = '2999-01-01T00:00:00.000Z';
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
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

function userId(email: string): string {
  const row = db
    .prepare<{ emailNormalized: string }, { id: string }>(
      'SELECT id FROM users WHERE email_normalized = @emailNormalized',
    )
    .get({ emailNormalized: normalizeEmail(email) });
  if (!row) throw new Error(`No user ${email}`);
  return row.id;
}

function tokenRows(): Record<string, unknown>[] {
  return db
    .prepare<[], Record<string, unknown>>('SELECT * FROM display_tokens ORDER BY rowid')
    .all();
}

/** The claims of an issued token, verified with the test secret and HS256 only. */
function claimsOf(token: string): JwtPayload {
  return jwt.verify(token, TEST_CONFIG.jwtSecret, { algorithms: ['HS256'] }) as JwtPayload;
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

function issueToken(body: unknown, token = firstAdminToken()) {
  const req = request(app).post(DISPLAY_TOKENS_PATH).set('Authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body as object);
}

/** A POST whose body is sent as raw JSON text, for bodies that are not objects. */
function issueTokenRaw(rawBody: string, token = firstAdminToken()) {
  return request(app)
    .post(DISPLAY_TOKENS_PATH)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .send(rawBody);
}

describe('POST /api/display-tokens', () => {
  it('answers 201 with exactly { token }, a display token of the stored row', async () => {
    const res = await issueToken({ label: 'Lobi ekranı' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ token: expect.any(String) });
    const claims = claimsOf(res.body.token);
    expect(claims).toEqual({
      kind: 'display',
      firmId: firstFirmId,
      iat: expect.any(Number),
      jti: expect.stringMatching(UUID),
    });
    expect(tokenRows()).toEqual([
      {
        id: claims.jti,
        firm_id: firstFirmId,
        label: 'Lobi ekranı',
        created_by_user_id: userId(FIRST_ADMIN_EMAIL),
        created_at: expect.stringMatching(ISO_TIMESTAMP),
      },
    ]);
  });

  it.each([
    { label: 'no body at all', body: undefined },
    { label: 'an empty object', body: {} },
  ])('issues a token with no label for $label', async ({ body }) => {
    const res = await issueToken(body);

    expect(res.status).toBe(201);
    expect(tokenRows()).toEqual([
      expect.objectContaining({ id: claimsOf(res.body.token).jti, label: null }),
    ]);
  });

  it('stores a blank label as sent', async () => {
    const res = await issueToken({ label: '  ' });

    expect(res.status).toBe(201);
    expect(tokenRows()).toEqual([expect.objectContaining({ label: '  ' })]);
  });

  it('gives every token its own jti', async () => {
    const first = await issueToken({});
    const second = await issueToken({});

    expect(first.body.token).not.toBe(second.body.token);
    expect(claimsOf(first.body.token).jti).not.toBe(claimsOf(second.body.token).jti);
    expect(tokenRows()).toHaveLength(2);
  });

  it("issues the second firm's admin a token for their own firm", async () => {
    const res = await issueToken({}, userTokenFor(db, SECOND_ADMIN_EMAIL));

    expect(res.status).toBe(201);
    expect(claimsOf(res.body.token).firmId).toBe(secondFirmId);
    expect(tokenRows()).toEqual([
      expect.objectContaining({
        firm_id: secondFirmId,
        created_by_user_id: userId(SECOND_ADMIN_EMAIL),
      }),
    ]);
  });

  it.each([
    { label: 'a number label', body: { label: 42 } },
    { label: 'a null label', body: { label: null } },
    { label: 'an object label', body: { label: {} } },
  ])('answers 400 for $label and writes no row', async ({ body }) => {
    const res = await issueToken(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual(VALIDATION_ERROR);
    expect(tokenRows()).toEqual([]);
  });

  it.each(['"x"', 'null', '[]'])(
    'answers 400 for the non-object JSON body %s and writes no row',
    async (rawBody) => {
      const res = await issueTokenRaw(rawBody);

      expect(res.status).toBe(400);
      expect(res.body).toEqual(VALIDATION_ERROR);
      expect(tokenRows()).toEqual([]);
    },
  );

  it.each([
    { label: 'a valid label', body: { label: 'Lobi' } },
    { label: 'an invalid label', body: { label: 42 } },
  ])('answers a member 403, not 400, for $label and writes no row', async ({ body }) => {
    const res = await issueToken(body, firstMemberToken());

    expect(res.status).toBe(403);
    expect(res.body).toEqual(FORBIDDEN);
    expect(tokenRows()).toEqual([]);
  });

  it('answers 403 to a firm admin demoted after their token was issued', async () => {
    const token = firstAdminToken();
    db.prepare("UPDATE users SET role = 'member' WHERE email_normalized = 'boss@first.test'").run();

    const res = await issueToken({}, token);

    expect(res.status).toBe(403);
    expect(res.body).toEqual(FORBIDDEN);
    expect(tokenRows()).toEqual([]);
  });

  it('answers 401 with no token', async () => {
    const res = await request(app).post(DISPLAY_TOKENS_PATH).send({ label: 42 });

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it('answers 401 with a display token', async () => {
    const displayToken = jwt.sign({ kind: 'display', firmId: firstFirmId }, TEST_CONFIG.jwtSecret, {
      algorithm: 'HS256',
      jwtid: randomUUID(),
    });

    const res = await issueToken({ label: 42 }, displayToken);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it('issues a token that HTTP rejects, because display tokens are for the socket only', async () => {
    const issued = await issueToken({});

    const res = await request(app)
      .get('/api/mode')
      .set('Authorization', `Bearer ${issued.body.token}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it('answers OPTIONS with the 404 envelope', async () => {
    const res = await request(app)
      .options(DISPLAY_TOKENS_PATH)
      .set('Authorization', `Bearer ${firstAdminToken()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });
});
