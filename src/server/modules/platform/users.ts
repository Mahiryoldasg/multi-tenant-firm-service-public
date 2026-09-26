import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { normalizeEmail } from '../../auth/email.ts';
import type { Role } from '../../auth/tokens.ts';

/** An active user of a live firm (or the platform admin): identity, role and firm. */
export interface ActiveUser {
  id: string;
  email: string;
  role: Role;
  firmId: string | null;
}

/** An active user as the login needs it, with the password hash. */
export interface CredentialUser extends ActiveUser {
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

/**
 * Finds the active user with this id. Like the email lookup, it checks the firm itself, so a user of
 * a soft-deleted firm is not found even if their own row was never soft-deleted.
 */
export function findActiveUserById(db: Database.Database, id: string): ActiveUser | undefined {
  return db
    .prepare<{ id: string }, ActiveUser>(
      `SELECT users.id, users.email, users.role, users.firm_id AS firmId
         FROM users
         LEFT JOIN firms ON firms.id = users.firm_id
        WHERE users.id = @id
          AND users.deleted_at IS NULL
          AND (users.firm_id IS NULL OR firms.deleted_at IS NULL)`,
    )
    .get({ id });
}

/** A user row to insert. The id is generated and the email normalized on insert. */
export interface NewUser {
  firmId: string | null;
  role: Role;
  email: string;
  passwordHash: string;
}

/**
 * Inserts a user and returns the new id. It opens no transaction and handles no email conflict: the
 * caller owns both, so a clash surfaces as the raw unique-constraint error.
 */
export function insertUser(db: Database.Database, now: string, user: NewUser): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO users
       (id, firm_id, email, email_normalized, password_hash, role, created_at, updated_at)
     VALUES (@id, @firmId, @email, @emailNormalized, @passwordHash, @role, @now, @now)`,
  ).run({ ...user, id, emailNormalized: normalizeEmail(user.email), now });
  return id;
}
