import type Database from 'better-sqlite3';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, TEST_CONFIG } from '../helpers/app.ts';
import { userTokenFor } from '../helpers/auth.ts';
import { TEST_SEED } from '../helpers/db.ts';

const FIRMS_PATH = '/api/firms';
const DELETED_AT = '2026-09-25T12:00:00.000Z';
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PLATFORM_ADMIN_EMAIL = TEST_SEED.platformAdmin.email;
const FIRST_ADMIN_EMAIL = TEST_SEED.firms[0].adminEmail;

const UNAUTHORIZED = { error: { code: 'UNAUTHORIZED', message: expect.any(String) } };
const FORBIDDEN = { error: { code: 'FORBIDDEN', message: expect.any(String) } };
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: expect.any(String) } };

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
