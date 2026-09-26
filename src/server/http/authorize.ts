import type { RequestHandler } from 'express';
import { getAuth } from './authenticate.ts';
import { HttpError } from './errors.ts';

export const FORBIDDEN_MESSAGE = 'Bu işlem için yetkiniz yok.';

/** Lets only the platform admin through; a firm user gets 403 whatever the method or path. */
export const requirePlatformAdmin: RequestHandler = (req, _res, next) => {
  // The role is the one `authenticate` read from the DB on this request, never the token claim.
  if (getAuth(req).role !== 'platform_admin') throw new HttpError('FORBIDDEN', FORBIDDEN_MESSAGE);
  next();
};
