import type Database from 'better-sqlite3';
import { normalizeEmail } from '../../src/server/auth/email.ts';
import { signUserToken } from '../../src/server/auth/tokens.ts';
import { findActiveUserByEmail } from '../../src/server/modules/platform/users.ts';
import { TEST_CONFIG } from './app.ts';

/** A valid user token for the active user with this email, signed with the test secret. */
export function userTokenFor(db: Database.Database, email: string): string {
  const user = findActiveUserByEmail(db, normalizeEmail(email));
  if (!user) throw new Error(`No active user ${email}`);
  return signUserToken(user, {
    secret: TEST_CONFIG.jwtSecret,
    ttlSeconds: TEST_CONFIG.userTokenTtlSeconds,
  });
}
