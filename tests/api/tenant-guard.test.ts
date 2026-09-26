import type Database from 'better-sqlite3';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeEmail } from '../../src/server/auth/email.ts';
import { findActiveUserByEmail } from '../../src/server/modules/platform/users.ts';
import { createTestApp, TEST_CONFIG } from '../helpers/app.ts';
import { userTokenFor } from '../helpers/auth.ts';
import { TEST_SEED } from '../helpers/db.ts';

// No tenant route exists yet (features 6 and 7 add them): 403 means the guard stopped the request,
// and 404 means it passed.
const METHODS = ['get', 'head', 'post', 'put', 'patch', 'delete', 'options'] as const;
type Method = (typeof METHODS)[number];

// `:secondAdminId` is replaced with the second firm admin's id, a real user of another firm.
const FIRM_CONTEXT_PATHS = [
  '/api/employees',
  '/api/employees/:secondAdminId',
  '/api/mode',
  '/api/display-tokens',
];

const FIRST_ADMIN_EMAIL = TEST_SEED.firms[0].adminEmail;
const SECOND_ADMIN_EMAIL = TEST_SEED.firms[1].adminEmail;

const UNAUTHORIZED = { error: { code: 'UNAUTHORIZED', message: expect.any(String) } };
const FORBIDDEN = { error: { code: 'FORBIDDEN', message: 'Bu işlem için yetkiniz yok.' } };
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: expect.any(String) } };

let app: Express;
let db: Database.Database;

beforeEach(async () => {
  ({ app, db } = await createTestApp());
});

afterEach(() => {
  if (db.open) db.close();
});

function firmUser(email: string) {
  const found = findActiveUserByEmail(db, normalizeEmail(email));
  if (!found?.firmId) throw new Error(`No active firm user ${email}`);
  return { id: found.id, firmId: found.firmId };
}

function resolve(path: string): string {
  return path.replace(':secondAdminId', firmUser(SECOND_ADMIN_EMAIL).id);
}

function send(method: Method, path: string, token?: string) {
  const req = request(app)[method](resolve(path));
  return token === undefined ? req : req.set('Authorization', `Bearer ${token}`);
}

function platformAdminToken(): string {
  return userTokenFor(db, TEST_SEED.platformAdmin.email);
}

/** A token for the first firm's admin after setting their role in the DB. */
function firmUserToken(role: 'firm_admin' | 'member'): string {
  db.prepare("UPDATE users SET role = @role WHERE email_normalized = 'boss@first.test'").run({
    role,
  });
  return userTokenFor(db, FIRST_ADMIN_EMAIL);
}

describe('the platform admin on a firm-context path', () => {
  it.each([
    ...FIRM_CONTEXT_PATHS.flatMap((path) => METHODS.map((method) => ({ method, path }))),
    // Subpaths and a malformed id are guarded too: the guard works on the prefix.
    { method: 'get' as const, path: '/api/employees/%E0' },
    { method: 'get' as const, path: '/api/mode/x' },
    { method: 'delete' as const, path: '/api/display-tokens/x/y' },
  ])('gets 403 for $method $path', async ({ method, path }) => {
    const res = await send(method, path, platformAdminToken());

    expect(res.status).toBe(403);
    // A HEAD response has no body.
    if (method !== 'head') expect(res.body).toEqual(FORBIDDEN);
  });

  it.each([
    { label: 'an empty body', body: {} },
    { label: 'an invalid role', body: { role: 'bogus' } },
  ])(
    'gets 403, not 404 or 400, for a PATCH of an unknown employee with $label',
    async ({ body }) => {
      const res = await send('patch', `/api/employees/${randomUUID()}`, platformAdminToken()).send(
        body,
      );

      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
    },
  );

  it('gets 403, not 400, for a POST /api/mode with no body', async () => {
    const res = await send('post', '/api/mode', platformAdminToken());

    expect(res.status).toBe(403);
    expect(res.body).toEqual(FORBIDDEN);
  });
});

describe('a firm user on a firm-context path', () => {
  // Requests no later feature routes, so these stay 404 after features 6 and 7.
  it.each(
    (['firm_admin', 'member'] as const).flatMap((role) =>
      [
        { method: 'put' as const, path: '/api/employees' },
        { method: 'get' as const, path: '/api/employees/x/y' },
        { method: 'put' as const, path: '/api/mode' },
        { method: 'get' as const, path: '/api/mode/x' },
        { method: 'get' as const, path: '/api/display-tokens' },
        { method: 'delete' as const, path: '/api/display-tokens/x' },
      ].map((route) => ({ role, ...route })),
    ),
  )('passes the guard as $role for $method $path', async ({ role, method, path }) => {
    const res = await send(method, path, firmUserToken(role));

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });
});

describe('authentication on a firm-context path', () => {
  it.each(FIRM_CONTEXT_PATHS)('answers 401 before 403 without a token on %s', async (path) => {
    const res = await send('get', path);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });

  it.each(FIRM_CONTEXT_PATHS)('answers 401 before 403 to a display token on %s', async (path) => {
    const displayToken = jwt.sign(
      { kind: 'display', firmId: firmUser(FIRST_ADMIN_EMAIL).firmId },
      TEST_CONFIG.jwtSecret,
      { algorithm: 'HS256', jwtid: randomUUID() },
    );

    const res = await send('get', path, displayToken);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHORIZED);
  });
});

describe('paths outside the firm context', () => {
  // Express matches a mount path by whole segment, so these neighbours are not guarded.
  it.each(['/api/employeesx', '/api/modex', '/api/display-tokensx'])(
    'answers the platform admin 404 on %s',
    async (path) => {
      const res = await send('get', path, platformAdminToken());

      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    },
  );

  it.each(['/api/firms', '/api/auth/me'])('still serves the platform admin %s', async (path) => {
    const res = await send('get', path, platformAdminToken());

    expect(res.status).toBe(200);
  });
});
