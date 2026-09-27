import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  healthResponseSchema,
  loginResponseSchema,
  meResponseSchema,
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

  it('match the /health response', async () => {
    const { app } = await createTestApp();

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expectDocumented(healthResponseSchema, res.body);
  });
});
