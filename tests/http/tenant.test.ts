import type Database from 'better-sqlite3';
import express from 'express';
import jwt from 'jsonwebtoken';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeEmail } from '../../src/server/auth/email.ts';
import { createAuthenticate } from '../../src/server/http/authenticate.ts';
import { errorHandler } from '../../src/server/http/error-handler.ts';
import { createRequireTenant, getTenant } from '../../src/server/http/tenant.ts';
import { findActiveUserByEmail, insertUser } from '../../src/server/modules/platform/users.ts';
import { TEST_CONFIG } from '../helpers/app.ts';
import { userTokenFor } from '../helpers/auth.ts';
import { createSeededDatabase, TEST_SEED } from '../helpers/db.ts';
import { NO_BROADCASTS } from '../helpers/scope.ts';

const PROBE_PATH = '/api/probe';
const LATER = '2999-01-01T00:00:00.000Z';
const FIRST_ADMIN_EMAIL = TEST_SEED.firms[0].adminEmail;
const SECOND_ADMIN_EMAIL = TEST_SEED.firms[1].adminEmail;

let db: Database.Database;
let app: express.Express;

beforeEach(async () => {
  db = await createSeededDatabase();
  // Real authenticate and guard, and a probe route that shows which firm `req.tenant` is bound to.
  app = express();
  app.use(pinoHttp({ logger: pino({ level: 'silent' }) }));
  app.use('/api', createAuthenticate({ db, config: TEST_CONFIG }));
  app.use(PROBE_PATH, createRequireTenant({ db, realtime: NO_BROADCASTS }));
  app.get(PROBE_PATH, (req, res) => {
    res.json(getTenant(req).employees.list());
  });
  app.use(errorHandler);
});

afterEach(() => {
  db.close();
});

/** An active firm user, with the firm id narrowed to a string. */
function firmUser(email: string) {
  const found = findActiveUserByEmail(db, normalizeEmail(email));
  if (!found?.firmId) throw new Error(`No active firm user ${email}`);
  return { id: found.id, firmId: found.firmId };
}

function addMember(firmId: string, email: string): string {
  return insertUser(db, LATER, { firmId, role: 'member', email, passwordHash: 'unused' });
}

function probe(token: string) {
  return request(app).get(PROBE_PATH).set('Authorization', `Bearer ${token}`);
}

describe('getTenant', () => {
  it('fails closed with 500 on a route that requireTenant does not guard', async () => {
    const unguarded = express();
    unguarded.use(pinoHttp({ logger: pino({ level: 'silent' }) }));
    unguarded.get('/unguarded', (req, res) => {
      res.json(getTenant(req).employees.list());
    });
    unguarded.use(errorHandler);

    const res = await request(unguarded).get('/unguarded');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: expect.any(String) } });
  });
});

describe('requireTenant', () => {
  it("binds req.tenant to the caller's own firm", async () => {
    const firstAdmin = firmUser(FIRST_ADMIN_EMAIL);
    const secondAdmin = firmUser(SECOND_ADMIN_EMAIL);
    const firstMember = addMember(firstAdmin.firmId, 'Member@First.Test');
    const secondMember = addMember(secondAdmin.firmId, 'Member@Second.Test');

    const first = await probe(userTokenFor(db, FIRST_ADMIN_EMAIL));
    const second = await probe(userTokenFor(db, SECOND_ADMIN_EMAIL));

    expect(first.status).toBe(200);
    expect(first.body).toEqual([
      { id: firstAdmin.id, email: FIRST_ADMIN_EMAIL, role: 'firm_admin' },
      { id: firstMember, email: 'Member@First.Test', role: 'member' },
    ]);
    expect(second.status).toBe(200);
    expect(second.body).toEqual([
      { id: secondAdmin.id, email: SECOND_ADMIN_EMAIL, role: 'firm_admin' },
      { id: secondMember, email: 'Member@Second.Test', role: 'member' },
    ]);
  });

  it("takes the firm from the DB, never from the token's firmId claim", async () => {
    const firstAdmin = firmUser(FIRST_ADMIN_EMAIL);
    // Correctly signed, but its firmId claim names the other firm.
    const token = jwt.sign(
      { sub: firstAdmin.id, role: 'firm_admin', firmId: firmUser(SECOND_ADMIN_EMAIL).firmId },
      TEST_CONFIG.jwtSecret,
      { algorithm: 'HS256', expiresIn: TEST_CONFIG.userTokenTtlSeconds },
    );

    const res = await probe(token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: firstAdmin.id, email: FIRST_ADMIN_EMAIL, role: 'firm_admin' }]);
  });

  it('answers the platform admin 403', async () => {
    const res = await probe(userTokenFor(db, TEST_SEED.platformAdmin.email));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: expect.any(String) } });
  });
});
