import type Database from 'better-sqlite3';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, TEST_CONFIG } from '../helpers/app.ts';
import { userTokenFor } from '../helpers/auth.ts';
import { TEST_SEED } from '../helpers/db.ts';

const ME_PATH = '/api/auth/me';
const DELETED_AT = '2026-09-25T12:00:00.000Z';
const FIRST_ADMIN = {
  email: TEST_SEED.firms[0].adminEmail,
  password: TEST_SEED.firms[0].adminPassword,
};
const UNAUTHORIZED = { error: { code: 'UNAUTHORIZED', message: expect.any(String) } };

let app: Express;
let db: Database.Database;

beforeEach(async () => {
  ({ app, db } = await createTestApp());
});

afterEach(() => {
  if (db.open) db.close();
});

function me(token?: string) {
  const req = request(app).get(ME_PATH);
  return token === undefined ? req : req.set('Authorization', `Bearer ${token}`);
}

function firmId(name: string): string {
  const row = db
    .prepare<{ name: string }, { id: string }>('SELECT id FROM firms WHERE name = @name')
    .get({ name });
  if (!row) throw new Error(`No firm named ${name}`);
  return row.id;
}

function setFirstAdminRole(role: string): void {
  db.prepare("UPDATE users SET role = @role WHERE email_normalized = 'boss@first.test'").run({
    role,
  });
}

describe('GET /api/auth/me success', () => {
  it('returns the same user object as the login that issued the token', async () => {
    const login = await request(app).post('/api/auth/login').send(FIRST_ADMIN).expect(200);

    const res = await me(login.body.token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: login.body.user });
  });

  it('returns exactly id, email in the stored casing, role and firmId for a firm admin', async () => {
    const res = await me(userTokenFor(db, 'boss@first.test'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: {
        id: expect.any(String),
        email: 'Boss@First.Test',
        role: 'firm_admin',
        firmId: firmId('First Test Firm'),
      },
    });
  });

  it('omits firmId for the platform admin', async () => {
    const res = await me(userTokenFor(db, TEST_SEED.platformAdmin.email));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: { id: expect.any(String), email: 'Root@Platform.Test', role: 'platform_admin' },
    });
    expect(res.body.user).not.toHaveProperty('firmId');
  });

  it('reads the role from the DB, so a role change applies to the old token on the next request', async () => {
    const token = userTokenFor(db, FIRST_ADMIN.email);

    setFirstAdminRole('member');
    const demoted = await me(token);
    setFirstAdminRole('firm_admin');
    const restored = await me(token);

    expect(demoted.body.user.role).toBe('member');
    expect(restored.body.user.role).toBe('firm_admin');
  });
});

describe('GET /api/auth/me failure', () => {
  it('answers 401 without a token', async () => {
    const res = await me();

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it('answers 401 for a display token', async () => {
    const token = jwt.sign(
      { kind: 'display', firmId: firmId('First Test Firm') },
      TEST_CONFIG.jwtSecret,
      {
        algorithm: 'HS256',
        jwtid: randomUUID(),
      },
    );

    const res = await me(token);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it.each([
    {
      label: 'the user was soft-deleted',
      softDelete: () =>
        db
          .prepare("UPDATE users SET deleted_at = @at WHERE email_normalized = 'boss@first.test'")
          .run({ at: DELETED_AT }),
    },
    {
      label: 'only the firm was soft-deleted',
      softDelete: () =>
        db
          .prepare('UPDATE firms SET deleted_at = @at WHERE id = @id')
          .run({ at: DELETED_AT, id: firmId('First Test Firm') }),
    },
  ])('answers 401 for an old token once $label', async ({ softDelete }) => {
    const token = userTokenFor(db, FIRST_ADMIN.email);
    await me(token).expect(200);

    softDelete();
    const res = await me(token);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it('answers POST with a valid token with the 404 envelope (no 405)', async () => {
    const res = await request(app)
      .post(ME_PATH)
      .set('Authorization', `Bearer ${userTokenFor(db, FIRST_ADMIN.email)}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });
});
