import express from 'express';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler, notFoundHandler } from '../../src/server/http/error-handler.ts';
import { type ErrorCode, HttpError } from '../../src/server/http/errors.ts';
import { createCapturingLogger } from '../helpers/log.ts';

const INTERNAL_DETAIL = 'SQLITE internal detail';

// A minimal app with the real handlers, so each error kind can be thrown on purpose.
function createThrowingApp() {
  const { logger, output } = createCapturingLogger();
  const app = express();
  app.use(pinoHttp({ logger }));
  app.get('/http-error/:code', (req) => {
    throw new HttpError(req.params.code as ErrorCode, 'Deneme mesajı.');
  });
  app.get('/sync-error', () => {
    throw new Error(INTERNAL_DETAIL);
  });
  app.get('/async-error', async () => {
    throw new Error(INTERNAL_DETAIL);
  });
  app.get('/param/:id', (req, res) => {
    res.json({ id: req.params.id });
  });
  app.get('/uri-error', () => {
    throw new URIError(INTERNAL_DETAIL);
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, output };
}

describe('errorHandler', () => {
  it.each([
    { code: 'UNAUTHORIZED', status: 401 },
    { code: 'FORBIDDEN', status: 403 },
    { code: 'NOT_FOUND', status: 404 },
    { code: 'VALIDATION_ERROR', status: 400 },
    { code: 'CONFLICT', status: 409 },
  ])('answers a thrown $code HttpError with $status and the envelope', async ({ code, status }) => {
    const { app } = createThrowingApp();

    const res = await request(app).get(`/http-error/${code}`);

    expect(res.status).toBe(status);
    expect(res.type).toBe('application/json');
    expect(res.body).toEqual({ error: { code, message: 'Deneme mesajı.' } });
  });

  it.each(['/sync-error', '/async-error'])(
    'answers an unexpected error on %s with 500 and logs the detail only',
    async (path) => {
      const { app, output } = createThrowingApp();

      const res = await request(app).get(path);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: expect.any(String) } });
      expect(res.text).not.toContain(INTERNAL_DETAIL);
      expect(output()).toContain(INTERNAL_DETAIL);
    },
  );

  it("answers the router's malformed percent-encoded param with the 404 envelope", async () => {
    const { app } = createThrowingApp();

    const res = await request(app).get('/param/%E0');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });

  it('keeps any other URIError a 500', async () => {
    const { app } = createThrowingApp();

    const res = await request(app).get('/uri-error');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: expect.any(String) } });
  });
});

describe('notFoundHandler', () => {
  it('answers a request no route handled with the 404 envelope', async () => {
    const { app } = createThrowingApp();

    const res = await request(app).get('/missing');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });
});
