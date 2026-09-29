import type Database from 'better-sqlite3';
import { verifyToken } from '../auth/tokens.ts';
import { AUTH_REQUIRED_MESSAGE, INVALID_SESSION_MESSAGE } from '../http/authenticate.ts';
import { FORBIDDEN_MESSAGE } from '../http/authorize.ts';
import { findActiveUserById } from '../modules/platform/users.ts';

export const DISPLAY_TOKEN_ON_CONTROL_MESSAGE = 'Kontrol kanalına display token ile bağlanılamaz.';

export type ControlAuthResult = { ok: true; firmId: string } | { ok: false; message: string };

export interface ControlAuthDeps {
  db: Database.Database;
  secret: string;
}

/**
 * Checks a `/control` handshake `auth` (not in the contract): only a live firm user's HS256 token
 * connects, in the HTTP order (401 before 403) and with the HTTP messages. On success `firmId` is
 * the firm of the user row, not the claim.
 */
export function authenticateControl(
  auth: unknown,
  { db, secret }: ControlAuthDeps,
): ControlAuthResult {
  const token = typeof auth === 'object' && auth !== null ? Reflect.get(auth, 'token') : undefined;
  if (typeof token !== 'string' || token.trim() === '') return reject(AUTH_REQUIRED_MESSAGE);

  const claims = verifyToken(token, secret);
  if (!claims) return reject(INVALID_SESSION_MESSAGE);
  if (claims.kind === 'display') return reject(DISPLAY_TOKEN_ON_CONTROL_MESSAGE);
  if (claims.kind !== undefined || typeof claims.sub !== 'string') {
    return reject(INVALID_SESSION_MESSAGE);
  }

  // As on HTTP, the DB decides: a deleted user, or a user of a deleted firm, is not found.
  const user = findActiveUserById(db, claims.sub);
  if (!user) return reject(INVALID_SESSION_MESSAGE);
  // Only firm users have a firm's mode to follow; the platform admin gets the 403 message.
  if (user.firmId === null) return reject(FORBIDDEN_MESSAGE);
  return { ok: true, firmId: user.firmId };
}

function reject(message: string): ControlAuthResult {
  return { ok: false, message };
}
