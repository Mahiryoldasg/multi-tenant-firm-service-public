import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  activeModeResponseSchema,
  createFirmResponseSchema,
  displayTokenResponseSchema,
  employeeListResponseSchema,
  employeeResponseSchema,
  firmListResponseSchema,
  firmResponseSchema,
  healthResponseSchema,
  loginResponseSchema,
  meResponseSchema,
  setModeResponseSchema,
} from '../../src/server/openapi/schemas.ts';
import { createTestApp } from '../helpers/app.ts';
import { userTokenFor } from '../helpers/auth.ts';
import { TEST_SEED } from '../helpers/db.ts';

// The documented response schemas are not used by the handlers, so real responses prove them. A
// missing or mistyped field fails the parse; an undocumented one is stripped, so the result differs.
function expectDocumented(schema: z.ZodType, body: unknown): void {
  expect(schema.parse(body)).toEqual(body);
}

const PLATFORM_ADMIN = TEST_SEED.platformAdmin;
const FIRM_ADMIN = {
  email: TEST_SEED.firms[0].adminEmail,
  password: TEST_SEED.firms[0].adminPassword,
};

describe('documented response schemas', () => {
  it.each([
    ['the platform admin', PLATFORM_ADMIN],
    ['a firm admin', FIRM_ADMIN],
  ])('match the login response of %s', async (_label, credentials) => {
    const { app } = await createTestApp();

    const res = await request(app).post('/api/auth/login').send(credentials);

    expect(res.status).toBe(200);
    expectDocumented(loginResponseSchema, res.body);
  });

  it.each([
    ['the platform admin', PLATFORM_ADMIN.email],
    ['a firm admin', FIRM_ADMIN.email],
  ])('match the /api/auth/me response of %s', async (_label, email) => {
    const { app, db } = await createTestApp();

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${userTokenFor(db, email)}`);

    expect(res.status).toBe(200);
    expectDocumented(meResponseSchema, res.body);
  });

  it('match the firm list, create and rename responses', async () => {
    const { app, db } = await createTestApp();
    const auth = `Bearer ${userTokenFor(db, PLATFORM_ADMIN.email)}`;

    const list = await request(app).get('/api/firms').set('Authorization', auth);
    const created = await request(app)
      .post('/api/firms')
      .set('Authorization', auth)
      .send({ name: 'Third Firm', adminEmail: 'boss@third.test', adminPassword: 'third-secret' });
    const renamed = await request(app)
      .patch(`/api/firms/${created.body.firm.id}`)
      .set('Authorization', auth)
      .send({ name: 'Third Firm Renamed' });

    expect([list.status, created.status, renamed.status]).toEqual([200, 201, 200]);
    expectDocumented(firmListResponseSchema, list.body);
    expectDocumented(createFirmResponseSchema, created.body);
    expectDocumented(firmResponseSchema, renamed.body);
  });

  it('match the employee list, get, create and update responses', async () => {
    const { app, db } = await createTestApp();
    const auth = `Bearer ${userTokenFor(db, FIRM_ADMIN.email)}`;

    const created = await request(app)
      .post('/api/employees')
      .set('Authorization', auth)
      .send({ email: 'member@first.test', password: 'member-secret', role: 'member' });
    const list = await request(app).get('/api/employees').set('Authorization', auth);
    const read = await request(app)
      .get(`/api/employees/${created.body.employee.id}`)
      .set('Authorization', auth);
    const updated = await request(app)
      .patch(`/api/employees/${created.body.employee.id}`)
      .set('Authorization', auth)
      .send({ role: 'firm_admin' });

    expect([created.status, list.status, read.status, updated.status]).toEqual([
      201, 200, 200, 200,
    ]);
    expectDocumented(employeeResponseSchema, created.body);
    expectDocumented(employeeListResponseSchema, list.body);
    expectDocumented(employeeResponseSchema, read.body);
    expectDocumented(employeeResponseSchema, updated.body);
  });

  it('match the mode responses before and after a mode is set', async () => {
    const { app, db } = await createTestApp();
    const auth = `Bearer ${userTokenFor(db, FIRM_ADMIN.email)}`;

    const unset = await request(app).get('/api/mode').set('Authorization', auth);
    const set = await request(app)
      .post('/api/mode')
      .set('Authorization', auth)
      .send({ modeId: 'welcome-screen' });
    const current = await request(app).get('/api/mode').set('Authorization', auth);

    expect([unset.status, set.status, current.status]).toEqual([200, 200, 200]);
    expect(unset.body.modeId).toBeNull();
    expectDocumented(activeModeResponseSchema, unset.body);
    expectDocumented(setModeResponseSchema, set.body);
    expectDocumented(activeModeResponseSchema, current.body);
  });

  it('match the display token response', async () => {
    const { app, db } = await createTestApp();

    const res = await request(app)
      .post('/api/display-tokens')
      .set('Authorization', `Bearer ${userTokenFor(db, FIRM_ADMIN.email)}`)
      .send({ label: 'Hall A' });

    expect(res.status).toBe(201);
    expectDocumented(displayTokenResponseSchema, res.body);
  });

  it('match the /health response', async () => {
    const { app } = await createTestApp();

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expectDocumented(healthResponseSchema, res.body);
  });
});

// Where an operation documents its own error message, the example must be the body a client gets
// for the cause the description lists first.
describe('operation-specific error examples', () => {
  const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

  interface NotFoundCase {
    method: 'get' | 'patch' | 'delete';
    path: string;
    email: string;
    body?: object;
  }

  const NOT_FOUND_CASES: NotFoundCase[] = [
    { method: 'patch', path: '/api/firms/{id}', email: PLATFORM_ADMIN.email, body: { name: 'X' } },
    { method: 'delete', path: '/api/firms/{id}', email: PLATFORM_ADMIN.email },
    { method: 'get', path: '/api/employees/{id}', email: FIRM_ADMIN.email },
    {
      method: 'patch',
      path: '/api/employees/{id}',
      email: FIRM_ADMIN.email,
      body: { role: 'member' },
    },
    { method: 'delete', path: '/api/employees/{id}', email: FIRM_ADMIN.email },
  ];

  it.each(NOT_FOUND_CASES)(
    'match the 404 of $method $path for an unknown id',
    async ({ method, path, email, body }) => {
      const { app, db } = await createTestApp();
      const document = (await request(app).get('/openapi.json')).body;

      const res = await request(app)
        [method](path.replace('{id}', UNKNOWN_ID))
        .set('Authorization', `Bearer ${userTokenFor(db, email)}`)
        .send(body);

      expect(res.status).toBe(404);
      expect(res.body).toEqual(
        document.paths[path][method].responses['404'].content['application/json'].example,
      );
    },
  );

  it('match the login 401 for a wrong password', async () => {
    const { app } = await createTestApp();
    const document = (await request(app).get('/openapi.json')).body;

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: PLATFORM_ADMIN.email, password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual(
      document.paths['/api/auth/login'].post.responses['401'].content['application/json'].example,
    );
  });
});
