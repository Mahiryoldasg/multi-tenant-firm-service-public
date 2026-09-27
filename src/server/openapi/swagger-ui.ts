import type { RequestHandler } from 'express';
import swaggerUi from 'swagger-ui-express';
import { notFoundHandler } from '../http/error-handler.ts';
import { OPENAPI_DOCUMENT } from './document.ts';

const OPTIONS = {
  customSiteTitle: 'Multi-Tenant Firm Service API',
  // Keeps a token pasted into Authorize across page reloads.
  swaggerOptions: { persistAuthorization: true },
};

// The files the page links. Behind them swagger-ui-express serves every swagger-ui-dist file to GET
// and HEAD, including its stock index.html (which loads the Petstore demo), and answers any method
// on a path ending in /swagger-ui-init.js (the script) or /package.json (a plain-text 404).
const PAGE_ASSETS = new Set([
  '/swagger-ui.css',
  '/swagger-ui-bundle.js',
  '/swagger-ui-standalone-preset.js',
  '/swagger-ui-init.js',
  '/favicon-32x32.png',
  '/favicon-16x16.png',
]);

/** Lets through only reads of the page and its assets; anything else gets the 404 envelope. */
const onlyPageReads: RequestHandler = (req, res, next) => {
  const isRead = req.method === 'GET' || req.method === 'HEAD';
  if (isRead && (req.path === '/' || PAGE_ASSETS.has(req.path))) {
    next();
    return;
  }
  notFoundHandler(req, res, next);
};

/**
 * The Swagger UI assets, mounted with `app.use('/docs')`. `serveFiles` ties the init script to this
 * document; `swaggerUi.serve` would serve whatever the last `setup()` call in the process set. Its
 * static middleware also redirects `/docs` to `/docs/`, where the page's relative asset links
 * (`./swagger-ui.css`) resolve.
 */
export const swaggerUiAssets: RequestHandler[] = [
  onlyPageReads,
  ...swaggerUi.serveFiles(OPENAPI_DOCUMENT, OPTIONS),
];

/** The Swagger UI page, mounted with `app.get('/docs')` so other methods keep the 404 envelope. */
export const swaggerUiPage: RequestHandler = swaggerUi.setup(OPENAPI_DOCUMENT, OPTIONS);
