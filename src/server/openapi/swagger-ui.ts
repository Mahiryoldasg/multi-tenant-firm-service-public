import type { RequestHandler } from 'express';
import swaggerUi from 'swagger-ui-express';
import { OPENAPI_DOCUMENT } from './document.ts';

const OPTIONS = {
  customSiteTitle: 'Multi-Tenant Firm Service API',
  // Keeps a token pasted into Authorize across page reloads.
  swaggerOptions: { persistAuthorization: true },
};

/**
 * The Swagger UI assets, mounted with `app.use('/docs')`. `serveFiles` ties the init script to this
 * document; `swaggerUi.serve` would serve whatever the last `setup()` call in the process set. Its
 * static middleware also redirects `/docs` to `/docs/`, where the page's relative asset links
 * (`./swagger-ui.css`) resolve.
 */
export const swaggerUiAssets: RequestHandler[] = swaggerUi.serveFiles(OPENAPI_DOCUMENT, OPTIONS);

/** The Swagger UI page, mounted with `app.get('/docs')` so other methods keep the 404 envelope. */
export const swaggerUiPage: RequestHandler = swaggerUi.setup(OPENAPI_DOCUMENT, OPTIONS);
