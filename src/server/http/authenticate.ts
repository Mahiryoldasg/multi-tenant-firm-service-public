import type Database from 'better-sqlite3';
import type { Request, RequestHandler } from 'express';
import { type Role, verifyToken } from '../auth/tokens.ts';
import type { AppConfig } from '../config.ts';
import { findActiveUserById } from '../modules/platform/users.ts';
import { HttpError } from './errors.ts';

/** The verified caller, as the DB says on this request. */
export interface AuthContext {
  userId: string;
  email: string;
  role: Role;
  firmId: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

const AUTH_REQUIRED_MESSAGE = 'Oturum açmanız gerekiyor.';
/** The 401 message for a token that no longer belongs to a live user of a live firm. */
export const INVALID_SESSION_MESSAGE = 'Oturumunuz geçersiz veya süresi dolmuş.';
const DISPLAY_TOKEN_MESSAGE = 'Display token yalnız socket bağlantısı için geçerlidir.';

const BEARER_PATTERN = /^Bearer +(\S+)$/i;

export interface AuthenticateDeps {
  db: Database.Database;
  config: Pick<AppConfig, 'jwtSecret'>;
}

/** Accepts only a live user's HS256 token and sets `req.auth` from the DB; anything else is 401. */
export function createAuthenticate({ db, config }: AuthenticateDeps): RequestHandler {
  return (req, _res, next) => {
    const token = BEARER_PATTERN.exec(req.headers.authorization ?? '')?.[1];
    if (!token) throw new HttpError('UNAUTHORIZED', AUTH_REQUIRED_MESSAGE);

    const claims = verifyToken(token, config.jwtSecret);
    if (!claims) throw new HttpError('UNAUTHORIZED', INVALID_SESSION_MESSAGE);
    // Display tokens are for the socket handshake only (contract §2).
    if (claims.kind === 'display') throw new HttpError('UNAUTHORIZED', DISPLAY_TOKEN_MESSAGE);
    if (claims.kind !== undefined || typeof claims.sub !== 'string') {
      throw new HttpError('UNAUTHORIZED', INVALID_SESSION_MESSAGE);
    }

    // Role and firm come from the DB, never from the token, so a role change or a deletion applies
    // on the very next request.
    const user = findActiveUserById(db, claims.sub);
    if (!user) throw new HttpError('UNAUTHORIZED', INVALID_SESSION_MESSAGE);

    req.auth = { userId: user.id, email: user.email, role: user.role, firmId: user.firmId };
    next();
  };
}

/** The caller of a route behind `authenticate`. */
export function getAuth(req: Request): AuthContext {
  // A route mounted outside `authenticate` is a bug: fail with a 500 instead of running anonymously.
  if (!req.auth) throw new Error('getAuth was called on a route that authenticate does not guard');
  return req.auth;
}
