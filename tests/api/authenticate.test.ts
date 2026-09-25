import type Database from 'better-sqlite3';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeEmail } from '../../src/server/auth/email.ts';
import { signUserToken } from '../../src/server/auth/tokens.ts';
import {
  type CredentialUser,
  findActiveUserByEmail,
} from '../../src/server/modules/platform/users.ts';
import { createTestApp, TEST_CONFIG } from '../helpers/app.ts';
import { userTokenFor } from '../helpers/auth.ts';
import { TEST_SEED } from '../helpers/db.ts';

// No route lives here, so 401 means authentication stopped the request and 404 means it passed.
const PROBE_PATH = '/api/nope';
const DELETED_AT = '2026-09-25T12:00:00.000Z';
const FIRST_ADMIN_EMAIL = TEST_SEED.firms[0].adminEmail;
const UNAUTHORIZED = { error: { code: 'UNAUTHORIZED', message: expect.any(String) } };
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: expect.any(String) } };

let app: Express;
let db: Database.Database;

beforeEach(async () => {
  ({ app, db } = await createTestApp());
});

afterEach(() => {
  vi.useRealTimers();
  if (db.open) db.close();
});

function probe(authorization?: string) {
  const req = request(app).get(PROBE_PATH);
  return authorization === undefined ? req : req.set('Authorization', authorization);
}

function firstAdmin(): CredentialUser {
  const user = findActiveUserByEmail(db, normalizeEmail(FIRST_ADMIN_EMAIL));
  if (!user) throw new Error('The first firm admin is not active');
  return user;
}

function sign(claims: object, options: jwt.SignOptions = {}): string {
  return jwt.sign(claims, TEST_CONFIG.jwtSecret, { algorithm: 'HS256', ...options });
}

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('authenticate rejects with 401', () => {
  it.each([
    { label: 'no Authorization header', authorization: () => undefined },
    { label: 'a Basic credential', authorization: () => `Basic ${btoa('boss:first-secret')}` },
    { label: 'Bearer with no token', authorization: () => 'Bearer' },
    {
      label: 'Bearer with a second part',
      authorization: () => `Bearer ${userTokenFor(db, FIRST_ADMIN_EMAIL)} extra`,
    },
    { label: 'a malformed token', authorization: () => 'Bearer not.a.jwt' },
    {
      label: 'a user token signed with another secret',
      authorization: () =>
        `Bearer ${signUserToken(firstAdmin(), { secret: 'other-secret', ttlSeconds: 60 })}`,
    },
    {
      label: 'a user token signed HS512 with the right secret',
      authorization: () => {
        const { id, role, firmId } = firstAdmin();
        return `Bearer ${sign({ sub: id, role, firmId }, { algorithm: 'HS512' })}`;
      },
    },
    {
      label: 'an unsigned alg none token with valid claims',
      authorization: () => {
        const { id, role, firmId } = firstAdmin();
        return `Bearer ${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({ sub: id, role, firmId })}.`;
      },
    },
    {
      label: 'a display token of a live firm',
      authorization: () =>
        `Bearer ${sign({ kind: 'display', firmId: firstAdmin().firmId }, { jwtid: randomUUID() })}`,
    },
    {
      // With a live user's sub, only the kind check can stop these two.
      label: "a display token that also carries a live user's sub",
      authorization: () => {
        const { id, firmId } = firstAdmin();
        return `Bearer ${sign({ kind: 'display', firmId, sub: id }, { jwtid: randomUUID() })}`;
      },
    },
    {
      label: "a token of another kind with a live user's sub",
      authorization: () => {
        const { id, role, firmId } = firstAdmin();
        return `Bearer ${sign({ kind: 'service', sub: id, role, firmId })}`;
      },
    },
    {
      label: 'a token without sub',
      authorization: () => `Bearer ${sign({ role: 'firm_admin', firmId: firstAdmin().firmId })}`,
    },
    {
      label: 'a token with a numeric sub',
      authorization: () => `Bearer ${sign({ sub: 42, role: 'firm_admin' })}`,
    },
    {
      label: 'a token for an unknown user id',
      authorization: () => `Bearer ${sign({ sub: randomUUID(), role: 'platform_admin' })}`,
    },
  ])('for $label', async ({ authorization }) => {
    const res = await probe(authorization());

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it('for a token whose user was soft-deleted after it was issued', async () => {
    const token = userTokenFor(db, FIRST_ADMIN_EMAIL);
    db.prepare('UPDATE users SET deleted_at = @at WHERE id = @id').run({
      at: DELETED_AT,
      id: firstAdmin().id,
    });

    const res = await probe(`Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it("for a token whose firm alone was soft-deleted, the user's row still active", async () => {
    const token = userTokenFor(db, FIRST_ADMIN_EMAIL);
    db.prepare('UPDATE firms SET deleted_at = @at WHERE id = @id').run({
      at: DELETED_AT,
      id: firstAdmin().firmId,
    });

    const res = await probe(`Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it('for a user token that has expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const token = signUserToken(firstAdmin(), { secret: TEST_CONFIG.jwtSecret, ttlSeconds: 60 });
    vi.setSystemTime(Date.now() + 61_000);

    const res = await probe(`Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });
});

describe('authenticate lets a live user through', () => {
  it.each([
    { label: 'a firm admin', authorization: () => `Bearer ${userTokenFor(db, FIRST_ADMIN_EMAIL)}` },
    {
      label: 'the platform admin',
      authorization: () => `Bearer ${userTokenFor(db, TEST_SEED.platformAdmin.email)}`,
    },
    {
      label: 'a lowercase bearer scheme',
      authorization: () => `bearer ${userTokenFor(db, FIRST_ADMIN_EMAIL)}`,
    },
    {
      label: 'several spaces after the scheme',
      authorization: () => `Bearer   ${userTokenFor(db, FIRST_ADMIN_EMAIL)}`,
    },
  ])('with $label, reaching the 404 of an unknown path', async ({ authorization }) => {
    const res = await probe(authorization());

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });
});

describe('what authenticate leaves alone', () => {
  it('still answers unparseable JSON without a token with 400, since the body parser runs first', async () => {
    const res = await request(app)
      .post('/api/anything')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: expect.any(String) } });
  });

  it('keeps login public, even with a garbage Bearer header', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Authorization', 'Bearer garbage')
      .send({ email: FIRST_ADMIN_EMAIL, password: TEST_SEED.firms[0].adminPassword });

    expect(res.status).toBe(200);
  });

  it('keeps /health public', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
  });

  it('answers an unexpected failure with 500 and no internals, never 401', async () => {
    const token = userTokenFor(db, FIRST_ADMIN_EMAIL);
    db.close();

    const res = await probe(`Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: expect.any(String) } });
    expect(res.text).not.toMatch(/database|sqlite/i);
  });
});
