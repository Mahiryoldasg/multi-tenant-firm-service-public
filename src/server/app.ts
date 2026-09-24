import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';

export interface AppDeps {
  logger: Logger;
}

// After `npm run build` this file lives in dist/server, and the Vite build in dist/web.
const WEB_DIR = path.resolve(import.meta.dirname, '../web');
const BACKEND_PREFIXES = ['/api', '/docs', '/openapi.json', '/socket.io', '/health'];

function isBackendPath(urlPath: string): boolean {
  return BACKEND_PREFIXES.some((prefix) => urlPath === prefix || urlPath.startsWith(`${prefix}/`));
}

export function createApp({ logger }: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Control UI (production build only). In development Vite serves the UI and proxies API calls.
  if (existsSync(WEB_DIR)) {
    app.use(express.static(WEB_DIR));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || isBackendPath(req.path)) return next();
      res.sendFile(path.join(WEB_DIR, 'index.html'));
    });
  }

  return app;
}
