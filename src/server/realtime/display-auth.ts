import type Database from 'better-sqlite3';
import { verifyToken } from '../auth/tokens.ts';
import { findActiveFirmById } from '../modules/platform/firms.ts';

export const DISPLAY_TOKEN_REQUIRED_MESSAGE = 'Display token gerekli.';
export const USER_TOKEN_ON_SOCKET_MESSAGE =
  'Socket bağlantısı yalnız display token ile yapılabilir.';
/** Also the answer for a deleted or unknown firm, as HTTP answers a deleted firm's user. */
export const INVALID_DISPLAY_TOKEN_MESSAGE = 'Display token geçersiz.';

export type DisplayAuthResult = { ok: true; firmId: string } | { ok: false; message: string };

export interface DisplayAuthDeps {
  db: Database.Database;
  secret: string;
}

/**
 * Checks a Socket.IO handshake `auth` (contract §4): only our HS256 display token of a live firm
 * connects. On success `firmId` is the id of the firm row, not the claim.
 */
export function authenticateDisplay(
  auth: unknown,
  { db, secret }: DisplayAuthDeps,
): DisplayAuthResult {
  const token = typeof auth === 'object' && auth !== null ? Reflect.get(auth, 'token') : undefined;
  if (typeof token !== 'string' || token.trim() === '') {
    return reject(DISPLAY_TOKEN_REQUIRED_MESSAGE);
  }

  const claims = verifyToken(token, secret);
  if (!claims) return reject(INVALID_DISPLAY_TOKEN_MESSAGE);
  if ('sub' in claims || 'role' in claims) return reject(USER_TOKEN_ON_SOCKET_MESSAGE);
  if (claims.kind !== 'display' || typeof claims.firmId !== 'string') {
    return reject(INVALID_DISPLAY_TOKEN_MESSAGE);
  }

  // Only the firm decides (contract §2): the token outlives its issuer and dies with its firm.
  const firm = findActiveFirmById(db, claims.firmId);
  if (!firm) return reject(INVALID_DISPLAY_TOKEN_MESSAGE);
  return { ok: true, firmId: firm.id };
}

function reject(message: string): DisplayAuthResult {
  return { ok: false, message };
}
