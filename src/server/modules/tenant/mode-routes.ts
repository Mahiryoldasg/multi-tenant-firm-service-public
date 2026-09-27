import { Router } from 'express';
import { z } from 'zod';
import { INVALID_SESSION_MESSAGE } from '../../http/authenticate.ts';
import { requireFirmAdmin } from '../../http/authorize.ts';
import { notFoundHandler } from '../../http/error-handler.ts';
import { HttpError } from '../../http/errors.ts';
import { getTenant } from '../../http/tenant.ts';
import { INVALID_BODY_MESSAGE, parseBody, requiredString } from '../../http/validate.ts';

const MODE_ID_REQUIRED_MESSAGE = 'Mod kimliği (modeId) zorunludur.';

// `modeId` is opaque (contract §3): any non-blank string, kept untrimmed. Unknown fields are dropped.
const setModeBodySchema = z.object(
  { modeId: requiredString(MODE_ID_REQUIRED_MESSAGE) },
  { error: INVALID_BODY_MESSAGE },
);

/**
 * The active mode of the caller's firm, mounted on `/api/mode` behind `requireTenant`. It reads and
 * writes only through `getTenant(req)`, so the mode is always the caller's own firm's.
 */
export function createModeRouter(): Router {
  const router = Router();

  router.get('/', (req, res) => {
    res.json({ modeId: getTenant(req).mode.get() });
  });

  // No `:id` to decode here, so a per-route guard still answers a member 403 before any 400.
  router.post('/', requireFirmAdmin, (req, res) => {
    const { modeId } = parseBody(setModeBodySchema, req.body);

    // The firm was checked live by `authenticate` and nothing is awaited since, so this is defense
    // in depth: a firm gone by now takes the caller's session with it.
    if (!getTenant(req).mode.set(new Date().toISOString(), modeId)) {
      throw new HttpError('UNAUTHORIZED', INVALID_SESSION_MESSAGE);
    }

    res.json({ modeId });
  });

  // Like the other routers: keeps every unhandled request, OPTIONS included, on the 404 envelope.
  router.use(notFoundHandler);

  return router;
}
