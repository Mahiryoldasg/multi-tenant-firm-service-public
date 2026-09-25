import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.ts';
import { createCapturingLogger } from '../helpers/log.ts';

type App = ReturnType<typeof createApp>;

function createTestApp() {
  const { logger, output } = createCapturingLogger();
  return { app: createApp({ logger }), output };
}

describe('unknown routes and methods', () => {
  it.each([
    { label: 'GET /api/nope', send: (app: App) => request(app).get('/api/nope') },
    { label: 'POST /nope', send: (app: App) => request(app).post('/nope') },
    { label: 'DELETE /health (no 405)', send: (app: App) => request(app).delete('/health') },
  ])('$label answers the 404 envelope as JSON', async ({ send }) => {
    const { app } = createTestApp();

    const res = await send(app);

    expect(res.status).toBe(404);
    expect(res.type).toBe('application/json');
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });
});

describe('unreadable request bodies', () => {
  it('answers malformed JSON with 400 and keeps the raw body out of the log', async () => {
    const { app, output } = createTestApp();

    const res = await request(app)
      .post('/api/anything')
      .set('Content-Type', 'application/json')
      .send('{"email":"a@b.test","password":"leak-me-123"');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: expect.any(String) } });
    expect(output()).toContain('"statusCode":400');
    expect(output()).not.toContain('leak-me-123');
  });

  it('answers a JSON body over the 100 kB limit with 400, not 413', async () => {
    const { app } = createTestApp();

    const res = await request(app)
      .post('/api/anything')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ data: 'x'.repeat(101 * 1024) }));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: expect.any(String) } });
  });
});
