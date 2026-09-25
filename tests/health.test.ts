import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers/app.ts';

describe('GET /health', () => {
  it('responds with status ok', async () => {
    const { app } = await createTestApp();

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
