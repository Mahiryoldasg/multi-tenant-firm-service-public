import { Router } from 'express';
import { z } from 'zod';
import { signDisplayToken } from '../../auth/tokens.ts';
import type { AppConfig } from '../../config.ts';
import { getAuth, INVALID_SESSION_MESSAGE } from '../../http/authenticate.ts';
import { requireFirmAdmin } from '../../http/authorize.ts';
import { notFoundHandler } from '../../http/error-handler.ts';
import { HttpError } from '../../http/errors.ts';
import { getTenant } from '../../http/tenant.ts';
import { INVALID_BODY_MESSAGE, parseBody } from '../../http/validate.ts';

const LABEL_INVALID_MESSAGE = 'Etiket (label) metin olmalı.';

// `label` is optional; when sent it is any string, stored as sent. `null` is not a string: 400.
const issueDisplayTokenBodySchema = z.object(
  { label: z.string({ error: LABEL_INVALID_MESSAGE }).optional() },
  { error: INVALID_BODY_MESSAGE },
);

export interface DisplayTokenRouterDeps {
  config: Pick<AppConfig, 'jwtSecret'>;
}

/**
 * Display token issuance for the caller's firm, mounted on `/api/display-tokens` behind
 * `requireTenant`. The token's firm and `jti` come from the row the firm-bound repository wrote.
 */
export function createDisplayTokenRouter({ config }: DisplayTokenRouterDeps): Router {
  const router = Router();

  // No `:id` to decode here, so a per-route guard still answers a member 403 before any 400.
  router.post('/', requireFirmAdmin, (req, res) => {
    // Every field is optional, so a request without a body (which Express leaves `undefined`) asks
    // for a token with no label. A JSON body that is not an object is still a 400.
    const { label } = parseBody(
      issueDisplayTokenBodySchema,
      req.body === undefined ? {} : req.body,
    );

    const issued = getTenant(req).displayTokens.create(new Date().toISOString(), {
      label: label ?? null,
      // Audit only, from the caller `authenticate` read from the DB; never from the body.
      createdByUserId: getAuth(req).userId,
    });
    // Nothing is awaited since `authenticate` checked the firm, so this is defense in depth: a firm
    // gone by now takes the caller's session with it.
    if (!issued) throw new HttpError('UNAUTHORIZED', INVALID_SESSION_MESSAGE);

    res.status(201).json({ token: signDisplayToken(issued, config.jwtSecret) });
  });

  // Like the other routers: keeps every unhandled request, OPTIONS included, on the 404 envelope.
  router.use(notFoundHandler);

  return router;
}
