import express from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { getAuth } from '../../src/server/http/authenticate.ts';
import { errorHandler } from '../../src/server/http/error-handler.ts';

describe('getAuth', () => {
  it('fails closed with 500 on a route that authenticate does not guard', async () => {
    const app = express();
    app.use(pinoHttp({ logger: pino({ level: 'silent' }) }));
    app.get('/unguarded', (req, res) => {
      res.json(getAuth(req));
    });
    app.use(errorHandler);

    const res = await request(app).get('/unguarded');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: expect.any(String) } });
  });
});
