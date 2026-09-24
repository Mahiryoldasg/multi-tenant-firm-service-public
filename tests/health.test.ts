import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.ts';

describe('GET /health', () => {
  it('responds with status ok', async () => {
    const app = createApp({ logger: pino({ level: 'silent' }) });

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
