import type Database from 'better-sqlite3';
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { createLoginHandler } from './auth/login.ts';
import { meHandler } from './auth/me.ts';
import type { AppConfig } from './config.ts';
import { createAuthenticate } from './http/authenticate.ts';
import { requirePlatformAdmin } from './http/authorize.ts';
import { errorHandler, notFoundHandler } from './http/error-handler.ts';
import { createFirmRouter } from './modules/platform/firm-routes.ts';

export interface AppDeps {
  logger: Logger;
  db: Database.Database;
  config: Pick<AppConfig, 'jwtSecret' | 'userTokenTtlSeconds'>;
}

// After `npm run build` this file lives in dist/server, and the Vite build in dist/web.
const WEB_DIR = path.resolve(import.meta.dirname, '../web');
const BACKEND_PREFIXES = ['/api', '/docs', '/openapi.json', '/socket.io', '/health'];

function isBackendPath(urlPath: string): boolean {
  return BACKEND_PREFIXES.some((prefix) => urlPath === prefix || urlPath.startsWith(`${prefix}/`));
}

export function createApp({ logger, db, config }: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger }));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // The only public /api route, so it is registered before `authenticate` guards the rest of /api,
  // including unknown paths (401 before 404).
  app.post('/api/auth/login', createLoginHandler({ db, config }));
  app.use('/api', createAuthenticate({ db, config }));
  app.get('/api/auth/me', meHandler);
  // The guard covers every method and subpath under /api/firms, so a firm user gets 403 before
  // any 404.
  app.use('/api/firms', requirePlatformAdmin, createFirmRouter({ db }));

  // Control UI (production build only). In development Vite serves the UI and proxies API calls.
  if (existsSync(WEB_DIR)) {
    app.use(express.static(WEB_DIR));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || isBackendPath(req.path)) return next();
      res.sendFile(path.join(WEB_DIR, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
