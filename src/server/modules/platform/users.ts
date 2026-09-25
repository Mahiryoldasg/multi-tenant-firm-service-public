import type Database from 'better-sqlite3';
import type { Role } from '../../auth/tokens.ts';

/** An active user as the login needs it: identity, role, firm, and password hash. */
export interface CredentialUser {
  id: string;
  email: string;
  role: Role;
  firmId: string | null;
  passwordHash: string;
}

/**
 * Finds the active user with this normalized email across all firms. A soft-deleted user, or a user
 * of a soft-deleted firm, is not found. The partial unique index allows at most one active match.
 */
export function findActiveUserByEmail(
  db: Database.Database,
  emailNormalized: string,
): CredentialUser | undefined {
  return db
    .prepare<{ emailNormalized: string }, CredentialUser>(
      `SELECT users.id, users.email, users.role, users.firm_id AS firmId,
              users.password_hash AS passwordHash
         FROM users
         LEFT JOIN firms ON firms.id = users.firm_id
        WHERE users.email_normalized = @emailNormalized
          AND users.deleted_at IS NULL
          AND (users.firm_id IS NULL OR firms.deleted_at IS NULL)`,
    )
    .get({ emailNormalized });
}
