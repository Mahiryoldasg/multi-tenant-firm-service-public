import express from 'express';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('errorHandler on a file response', () => {
  const ASSET = 'console.log("asset");\n';
  const UNSATISFIABLE_RANGE = 'bytes=99999999-';
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'error-handler-'));
    writeFileSync(path.join(dir, 'asset.js'), ASSET);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Like the production UI block: express.static, then a route that answers with res.sendFile.
  function createFileApp() {
    const { logger, output } = createCapturingLogger();
    const app = express();
    app.use(pinoHttp({ logger }));
    app.use(express.static(dir));
    app.get('/page', (_req, res) => {
      res.sendFile(path.join(dir, 'asset.js'));
    });
    app.use(notFoundHandler);
    app.use(errorHandler);
    return { app, output };
  }

  /** The error keeps its own status and none of the file's headers, with no body and no log. */
  function expectBareFileError(res: request.Response, status: number, output: () => string) {
    expect(res.status).toBe(status);
    expect(res.headers['content-type']).toBeUndefined();
    expect(res.headers['etag']).toBeUndefined();
    expect(res.headers['cache-control']).toBeUndefined();
    expect(res.headers['last-modified']).toBeUndefined();
    expect(res.text).toBe('');
    expect(output()).not.toContain('Unhandled error');
  }

  it.each(['/asset.js', '/page'])(
    'answers an unsatisfiable Range on %s with 416 and its Content-Range',
    async (urlPath) => {
      const { app, output } = createFileApp();

      const res = await request(app).get(urlPath).set('Range', UNSATISFIABLE_RANGE);

      expectBareFileError(res, 416, output);
      expect(res.headers['content-range']).toBe(`bytes */${Buffer.byteLength(ASSET)}`);
    },
  );

  it('answers a failed If-Match with 412', async () => {
    const { app, output } = createFileApp();

    const res = await request(app).get('/asset.js').set('If-Match', '"nope"');

    expectBareFileError(res, 412, output);
  });

  it('still serves the file itself', async () => {
    const { app } = createFileApp();

    const res = await request(app).get('/asset.js');

    expect(res.status).toBe(200);
    expect(res.text).toBe(ASSET);
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
