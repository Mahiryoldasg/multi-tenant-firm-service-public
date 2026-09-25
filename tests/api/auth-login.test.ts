import type Database from 'better-sqlite3';
import type { Express } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyPassword } from '../../src/server/auth/password.ts';
import { createTestApp, TEST_CONFIG } from '../helpers/app.ts';
import { userTokenFor } from '../helpers/auth.ts';
import { TEST_SEED } from '../helpers/db.ts';
import { createCapturingLogger } from '../helpers/log.ts';

// Spies on the real implementations, so a test can count password verifications.
vi.mock('../../src/server/auth/password.ts', { spy: true });

const LOGIN_PATH = '/api/auth/login';
const LOGIN_FAILED = { error: { code: 'UNAUTHORIZED', message: 'E-posta veya şifre hatalı.' } };
const DELETED_AT = '2026-09-25T12:00:00.000Z';
const FIRST_ADMIN = {
  email: TEST_SEED.firms[0].adminEmail,
  password: TEST_SEED.firms[0].adminPassword,
};

let app: Express;
let db: Database.Database;

beforeEach(async () => {
  ({ app, db } = await createTestApp());
  vi.mocked(verifyPassword).mockClear();
});

afterEach(() => {
  if (db.open) db.close();
});

function login(body?: unknown, contentType?: string) {
  const req = request(app).post(LOGIN_PATH);
  if (contentType) req.set('Content-Type', contentType);
  return body === undefined ? req : req.send(body as string | object);
}

function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, TEST_CONFIG.jwtSecret, { algorithms: ['HS256'] }) as JwtPayload;
}

function firmId(name: string): string {
  const row = db
    .prepare<{ name: string }, { id: string }>('SELECT id FROM firms WHERE name = @name')
    .get({ name });
  if (!row) throw new Error(`No firm named ${name}`);
  return row.id;
}

describe('POST /api/auth/login success', () => {
  it('signs in the platform admin without a firmId', async () => {
    const res = await login({
      email: TEST_SEED.platformAdmin.email,
      password: TEST_SEED.platformAdmin.password,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      token: expect.any(String),
      user: { id: expect.any(String), email: 'Root@Platform.Test', role: 'platform_admin' },
    });
    expect(res.body.user).not.toHaveProperty('firmId');

    const claims = verifyToken(res.body.token);
    expect(claims).toEqual({
      sub: res.body.user.id,
      role: 'platform_admin',
      iat: expect.any(Number),
      exp: expect.any(Number),
    });
    expect(Number(claims.exp) - Number(claims.iat)).toBe(43200);
  });

  it('signs in a firm admin with the firmId of their firm', async () => {
    const expectedFirmId = firmId('First Test Firm');

    const res = await login(FIRST_ADMIN);

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: expect.any(String),
      email: 'Boss@First.Test',
      role: 'firm_admin',
      firmId: expectedFirmId,
    });
    expect(verifyToken(res.body.token)).toMatchObject({
      sub: res.body.user.id,
      role: 'firm_admin',
      firmId: expectedFirmId,
    });
  });

  it('matches the email in any casing and with spaces, and returns the stored casing', async () => {
    const res = await login({ email: '  BOSS@first.TEST ', password: FIRST_ADMIN.password });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('Boss@First.Test');
  });

  it('ignores unknown body fields', async () => {
    const res = await login({ ...FIRST_ADMIN, role: 'platform_admin', firmId: 'other' });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: 'firm_admin', firmId: firmId('First Test Firm') });
  });
});

describe('POST /api/auth/login failure', () => {
  function softDeleteFirstFirmWithUsers(): void {
    const id = firmId('First Test Firm');
    db.prepare('UPDATE firms SET deleted_at = @at WHERE id = @id').run({ at: DELETED_AT, id });
    db.prepare('UPDATE users SET deleted_at = @at WHERE firm_id = @id').run({ at: DELETED_AT, id });
  }

  it.each([
    { label: 'an unknown email', body: { email: 'nobody@first.test', password: 'first-secret' } },
    { label: 'a wrong password', body: { ...FIRST_ADMIN, password: 'wrong-secret' } },
    {
      label: 'the right password plus a trailing space',
      body: { ...FIRST_ADMIN, password: `${FIRST_ADMIN.password} ` },
    },
    {
      label: 'a soft-deleted user',
      body: FIRST_ADMIN,
      setup: () =>
        db
          .prepare("UPDATE users SET deleted_at = @at WHERE email_normalized = 'boss@first.test'")
          .run({ at: DELETED_AT }),
    },
    { label: 'a user of a deleted firm', body: FIRST_ADMIN, setup: softDeleteFirstFirmWithUsers },
  ])('answers the same 401 for $label', async ({ body, setup }) => {
    setup?.();

    const res = await login(body);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(LOGIN_FAILED);
  });

  it('still runs one real password verification for an unknown email', async () => {
    await login({ email: 'nobody@first.test', password: 'first-secret' });

    expect(vi.mocked(verifyPassword)).toHaveBeenCalledTimes(1);
    // A well-formed hash, so scrypt really runs instead of failing fast on the format.
    expect(vi.mocked(verifyPassword).mock.calls[0]?.[1]).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
  });

  it.each([
    { label: 'no body' },
    { label: 'a text/plain body', body: 'email=boss', contentType: 'text/plain' },
    { label: 'a JSON array', body: [] },
    { label: 'an empty object', body: {} },
    { label: 'a missing email', body: { password: 'first-secret' } },
    { label: 'a missing password', body: { email: 'boss@first.test' } },
    { label: 'a whitespace-only email', body: { email: ' \t ', password: 'first-secret' } },
    { label: 'a whitespace-only password', body: { email: 'boss@first.test', password: '   ' } },
    { label: 'a numeric email', body: { email: 42, password: 'first-secret' } },
    { label: 'a numeric password', body: { email: 'boss@first.test', password: 42 } },
  ])('answers 400 VALIDATION_ERROR for $label', async ({ body, contentType }) => {
    const res = await login(body, contentType);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: expect.any(String) } });
  });

  it('answers GET without a token with 401, since only POST is public', async () => {
    const res = await request(app).get(LOGIN_PATH);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
  });

  it('answers GET with a valid token with the 404 envelope', async () => {
    const res = await request(app)
      .get(LOGIN_PATH)
      .set('Authorization', `Bearer ${userTokenFor(db, FIRST_ADMIN.email)}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });

  it('answers an unexpected failure with 500 and no internals', async () => {
    db.close();

    const res = await login(FIRST_ADMIN);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: expect.any(String) } });
    expect(res.text).not.toMatch(/database|sqlite/i);
  });
});

describe('POST /api/auth/login logging', () => {
  it('never writes the password to the log', async () => {
    const { logger, output } = createCapturingLogger();
    const logged = await createTestApp({ logger });

    await request(logged.app).post(LOGIN_PATH).send(FIRST_ADMIN).expect(200);
    await request(logged.app)
      .post(LOGIN_PATH)
      .send({ ...FIRST_ADMIN, password: 'wrong-secret-123' })
      .expect(401);
    logged.db.close();

    expect(output()).toContain('"statusCode":200');
    expect(output()).toContain('"statusCode":401');
    expect(output()).not.toContain(FIRST_ADMIN.password);
    expect(output()).not.toContain('wrong-secret-123');
  });
});
