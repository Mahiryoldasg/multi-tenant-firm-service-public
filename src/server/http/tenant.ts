import type Database from 'better-sqlite3';
import type { Request, RequestHandler } from 'express';
import type { ModeBroadcaster } from '../tenancy/displays.ts';
import { createTenantScope, type TenantScope } from '../tenancy/scope.ts';
import { getAuth } from './authenticate.ts';
import { FORBIDDEN_MESSAGE } from './authorize.ts';
import { HttpError } from './errors.ts';

declare module 'express-serve-static-core' {
  interface Request {
    tenant?: TenantScope;
  }
}

export interface RequireTenantDeps {
  db: Database.Database;
  realtime: ModeBroadcaster;
}

/**
 * Guards the firm-context paths: a caller without a firm gets 403 whatever the method or path, and
 * a firm user gets `req.tenant`, bound to the firm `authenticate` read from the DB on this request.
 */
export function createRequireTenant({ db, realtime }: RequireTenantDeps): RequestHandler {
  return (req, _res, next) => {
    const { firmId } = getAuth(req);
    // The users CHECK makes a firmless caller exactly the platform admin (contract §3).
    if (firmId === null) throw new HttpError('FORBIDDEN', FORBIDDEN_MESSAGE);

    req.tenant = createTenantScope(db, firmId, realtime);
    next();
  };
}

/** The firm scope of a route behind `requireTenant`; the only data access tenant handlers get. */
export function getTenant(req: Request): TenantScope {
  // Like getAuth: a tenant route mounted outside the guard fails with a 500 instead of running.
  if (!req.tenant) {
    throw new Error('getTenant was called on a route that requireTenant does not guard');
  }
  return req.tenant;
}
