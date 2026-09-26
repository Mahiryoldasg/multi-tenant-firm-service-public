import type Database from 'better-sqlite3';
import type { Express as App } from 'express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeEmail } from '../../src/server/auth/email.ts';
import { INVALID_BODY_MESSAGE } from '../../src/server/http/validate.ts';
import { insertUser } from '../../src/server/modules/platform/users.ts';
import { createTestApp } from '../helpers/app.ts';
import { userTokenFor } from '../helpers/auth.ts';
import { TEST_SEED } from '../helpers/db.ts';
import { createCapturingLogger } from '../helpers/log.ts';

async function createLoggedApp() {
  const { logger, output } = createCapturingLogger();
  const { app, db } = await createTestApp({ logger });
  return { app, db, output };
}

describe('unknown routes and methods', () => {
  it.each([
    {
      // Under /api authentication runs first, so an unknown path needs a valid token to reach 404.
      label: 'GET /api/nope with a valid token',
      send: (app: App, db: Database.Database) =>
        request(app)
          .get('/api/nope')
          .set('Authorization', `Bearer ${userTokenFor(db, TEST_SEED.firms[0].adminEmail)}`),
    },
    { label: 'POST /nope', send: (app: App) => request(app).post('/nope') },
    { label: 'DELETE /health (no 405)', send: (app: App) => request(app).delete('/health') },
  ])('$label answers the 404 envelope as JSON', async ({ send }) => {
    const { app, db } = await createLoggedApp();

    const res = await send(app, db);

    expect(res.status).toBe(404);
    expect(res.type).toBe('application/json');
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });
});

describe('unreadable request bodies', () => {
  it('answers malformed JSON with 400 and keeps the raw body out of the log', async () => {
    const { app, output } = await createLoggedApp();

    const res = await request(app)
      .post('/api/anything')
      .set('Content-Type', 'application/json')
      .send('{"email":"a@b.test","password":"leak-me-123"');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: expect.any(String) } });
    expect(output()).toContain('"statusCode":400');
    expect(output()).not.toContain('leak-me-123');
  });

  it('answers a corrupt compressed body with 400, not an unhandled 500', async () => {
    const { app, output } = await createLoggedApp();

    const res = await request(app)
      .post('/api/anything')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip')
      .send('{"email":"a@b.test"}');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: expect.any(String) } });
    expect(output()).toContain('"statusCode":400');
    expect(output()).not.toContain('Unhandled error');
  });

  it('answers a JSON body over the 100 kB limit with 400, not 413', async () => {
    const { app } = await createLoggedApp();

    const res = await request(app)
      .post('/api/anything')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ data: 'x'.repeat(101 * 1024) }));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: expect.any(String) } });
  });
});

describe('parseable non-object JSON bodies', () => {
  // Valid JSON that is not an object: only unparseable JSON may skip the check order (contract §3).
  const NON_OBJECT_BODIES = ['"x"', 'null', '42', 'true'];
  const MEMBER_EMAIL = 'Member@First.Test';

  let app: App;
  let db: Database.Database;

  beforeEach(async () => {
    ({ app, db } = await createTestApp());
  });

  afterEach(() => {
    if (db.open) db.close();
  });

  function userId(email: string): string {
    const row = db
      .prepare<{ emailNormalized: string }, { id: string }>(
        'SELECT id FROM users WHERE email_normalized = @emailNormalized',
      )
      .get({ emailNormalized: normalizeEmail(email) });
    if (!row) throw new Error(`No user ${email}`);
    return row.id;
  }

  function memberToken(): string {
    const firm = db
      .prepare<[], { id: string }>("SELECT id FROM firms WHERE name = 'First Test Firm'")
      .get();
    if (!firm) throw new Error('No first firm');
    insertUser(db, new Date().toISOString(), {
      firmId: firm.id,
      role: 'member',
      email: MEMBER_EMAIL,
      passwordHash: 'unused',
    });
    return userTokenFor(db, MEMBER_EMAIL);
  }

  function snapshot(): unknown[] {
    return [
      db.prepare('SELECT * FROM users ORDER BY rowid').all(),
      db.prepare('SELECT * FROM firms ORDER BY rowid').all(),
    ];
  }

  /** Sends `rawBody` as JSON text, so the parser sees it exactly as written. */
  function sendJson(method: 'post' | 'patch', path: string, rawBody: string, token?: string) {
    const req = request(app)[method](path).set('Content-Type', 'application/json');
    return (token === undefined ? req : req.set('Authorization', `Bearer ${token}`)).send(rawBody);
  }

  it.each(NON_OBJECT_BODIES)(
    "answers a member's POST /api/employees with %s 403, not 400",
    async (rawBody) => {
      const token = memberToken();
      const before = snapshot();

      const res = await sendJson('post', '/api/employees', rawBody, token);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: expect.any(String) } });
      expect(snapshot()).toEqual(before);
    },
  );

  it.each(
    ['null', '"x"'].flatMap((rawBody) => [
      {
        rawBody,
        label: "another firm's employee",
        id: () => userId(TEST_SEED.firms[1].adminEmail),
      },
      { rawBody, label: 'an unknown id', id: () => randomUUID() },
    ]),
  )(
    "answers a firm admin's PATCH of $label with $rawBody 404, not 400",
    async ({ rawBody, id }) => {
      const token = userTokenFor(db, TEST_SEED.firms[0].adminEmail);
      const target = id();
      const before = snapshot();

      const res = await sendJson('patch', `/api/employees/${target}`, rawBody, token);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
      expect(snapshot()).toEqual(before);
    },
  );

  it("answers the platform admin's POST /api/employees with a JSON string 403", async () => {
    const res = await sendJson(
      'post',
      '/api/employees',
      '"x"',
      userTokenFor(db, TEST_SEED.platformAdmin.email),
    );

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: expect.any(String) } });
  });

  it("answers a firm admin's POST /api/firms with a JSON string 403", async () => {
    const before = snapshot();

    const res = await sendJson(
      'post',
      '/api/firms',
      '"x"',
      userTokenFor(db, TEST_SEED.firms[0].adminEmail),
    );

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: expect.any(String) } });
    expect(snapshot()).toEqual(before);
  });

  it('answers POST /api/employees with a JSON string and no token 401', async () => {
    const res = await sendJson('post', '/api/employees', '"x"');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
  });

  it.each(['"x"', 'null'])(
    "answers a firm admin's POST /api/employees with %s 400 from the schema, not the parser",
    async (rawBody) => {
      const before = snapshot();

      const res = await sendJson(
        'post',
        '/api/employees',
        rawBody,
        userTokenFor(db, TEST_SEED.firms[0].adminEmail),
      );

      expect(res.status).toBe(400);
      // The message is the behavior here: the handler's object schema answered, not the parser.
      expect(res.body).toEqual({
        error: { code: 'VALIDATION_ERROR', message: INVALID_BODY_MESSAGE },
      });
      expect(snapshot()).toEqual(before);
    },
  );

  it('answers POST /api/auth/login with a JSON string 400', async () => {
    const res = await sendJson('post', '/api/auth/login', '"x"');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: expect.any(String) } });
  });
});
