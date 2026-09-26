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
import { errorHandler, jsonBodyParser, notFoundHandler } from './http/error-handler.ts';
import { createRequireTenant } from './http/tenant.ts';
import { createFirmRouter } from './modules/platform/firm-routes.ts';
import { createEmployeeRouter } from './modules/tenant/employee-routes.ts';

export interface AppDeps {
  logger: Logger;
  db: Database.Database;
  config: Pick<AppConfig, 'jwtSecret' | 'userTokenTtlSeconds'>;
}

// After `npm run build` this file lives in dist/server, and the Vite build in dist/web.
const WEB_DIR = path.resolve(import.meta.dirname, '../web');
const BACKEND_PREFIXES = ['/api', '/docs', '/openapi.json', '/socket.io', '/health'];

/** Whether the SPA fallback must leave `urlPath` to the backend routes and the 404 handler. */
export function isBackendPath(urlPath: string): boolean {
  // Express routes case-insensitively (`/API/MODE` reaches the /api guards), so this check must too.
  const lowerPath = urlPath.toLowerCase();
  return BACKEND_PREFIXES.some(
    (prefix) => lowerPath === prefix || lowerPath.startsWith(`${prefix}/`),
  );
}

export function createApp({ logger, db, config }: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger }));
  app.use(jsonBodyParser);

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
  // The firm-context prefixes (contract §3): the platform admin gets 403 on every method and subpath
  // before any 404, and firm users get `req.tenant`. Tenant routers mount after this, with no `db`.
  app.use(['/api/employees', '/api/mode', '/api/display-tokens'], createRequireTenant({ db }));
  app.use('/api/employees', createEmployeeRouter());

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
