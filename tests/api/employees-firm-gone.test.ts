import type Database from 'better-sqlite3';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Password from '../../src/server/auth/password.ts';
import { softDeleteFirm } from '../../src/server/modules/platform/firms.ts';
import { createTestApp } from '../helpers/app.ts';
import { userTokenFor } from '../helpers/auth.ts';
import { TEST_SEED } from '../helpers/db.ts';

// Its own file, so this mock of the password module reaches no other test.
const hooks = vi.hoisted(() => ({ beforeHash: () => {} }));

// `hashPassword` runs the test hook, then the real hash: a firm deleted in the hook is deleted while
// the create handler awaits the hash, after authentication and before the insert.
vi.mock('../../src/server/auth/password.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof Password>();
  return {
    ...actual,
    hashPassword: (password: string) => {
      hooks.beforeHash();
      return actual.hashPassword(password);
    },
  };
});

const FIRST_ADMIN_EMAIL = TEST_SEED.firms[0].adminEmail;

let app: Express;
let db: Database.Database;

beforeEach(async () => {
  ({ app, db } = await createTestApp());
});

afterEach(() => {
  hooks.beforeHash = () => {};
  if (db.open) db.close();
});

describe('POST /api/employees when the firm is deleted mid-request', () => {
  it('answers 401 and inserts nothing, so the email stays free', async () => {
    const token = userTokenFor(db, FIRST_ADMIN_EMAIL);
    const firm = db
      .prepare<[], { id: string }>("SELECT id FROM firms WHERE name = 'First Test Firm'")
      .get();
    if (!firm) throw new Error('No first firm');
    // What a platform admin's DELETE /api/firms/:id does: the firm and its users in one transaction.
    hooks.beforeHash = () => {
      softDeleteFirm(db, new Date().toISOString(), firm.id);
    };

    const res = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'New@First.Test', password: 'new-secret', role: 'member' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
    expect(
      db
        .prepare("SELECT COUNT(*) AS count FROM users WHERE email_normalized = 'new@first.test'")
        .get(),
    ).toEqual({ count: 0 });
  });
});
