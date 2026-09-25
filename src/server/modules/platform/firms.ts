import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { normalizeEmail } from '../../auth/email.ts';
import { findActiveUserByEmail, insertUser } from './users.ts';

/** A firm as `GET /api/firms` lists it. */
export interface FirmSummary {
  id: string;
  name: string;
  createdAt: string;
}

/**
 * Lists the firms that are not soft-deleted, oldest first. `rowid` breaks ties, so firms created in
 * the same instant (the seed) keep their insertion order.
 */
export function listActiveFirms(db: Database.Database): FirmSummary[] {
  return db
    .prepare<[], FirmSummary>(
      `SELECT id, name, created_at AS createdAt
         FROM firms
        WHERE deleted_at IS NULL
        ORDER BY created_at, rowid`,
    )
    .all();
}

/** A new firm with its first firm admin; the password is already hashed. */
export interface NewFirmWithAdmin {
  name: string;
  adminEmail: string;
  adminPasswordHash: string;
}

/** A firm as the create and rename responses return it. */
export interface Firm {
  id: string;
  name: string;
}

/** A created firm and its first admin, in the shape `POST /api/firms` returns. */
export interface CreatedFirm {
  firm: Firm;
  admin: { id: string; email: string };
}

/**
 * Inserts a firm and its first firm admin. It opens no transaction and handles no email conflict:
 * the caller runs it inside one, so a failed admin insert leaves no firm behind.
 */
export function insertFirmWithAdmin(
  db: Database.Database,
  now: string,
  { name, adminEmail, adminPasswordHash }: NewFirmWithAdmin,
): CreatedFirm {
  const firmId = randomUUID();
  db.prepare(
    'INSERT INTO firms (id, name, created_at, updated_at) VALUES (@id, @name, @now, @now)',
  ).run({ id: firmId, name, now });
  const adminId = insertUser(db, now, {
    firmId,
    role: 'firm_admin',
    email: adminEmail,
    passwordHash: adminPasswordHash,
  });
  return { firm: { id: firmId, name }, admin: { id: adminId, email: adminEmail } };
}

/** What `createFirmWithAdmin` returns when an active user already has the admin email. */
export const EMAIL_TAKEN = 'email_taken';

/**
 * Creates a firm with its first firm admin in one `BEGIN IMMEDIATE` transaction. When an active user
 * already has the admin email it returns `EMAIL_TAKEN` and leaves no firm behind.
 */
export function createFirmWithAdmin(
  db: Database.Database,
  now: string,
  input: NewFirmWithAdmin,
): CreatedFirm | typeof EMAIL_TAKEN {
  const create = db.transaction((): CreatedFirm | typeof EMAIL_TAKEN => {
    // Under the write lock, so no other connection can take the email between check and insert.
    if (findActiveUserByEmail(db, normalizeEmail(input.adminEmail))) return EMAIL_TAKEN;
    return insertFirmWithAdmin(db, now, input);
  });

  try {
    return create.immediate();
  } catch (error) {
    // The unique index is the safety net for a clash the pre-check missed, such as an active user of
    // a firm whose users were never cascaded. Mapped only here, after the rollback: returning from
    // inside the transaction function would commit the firm row.
    if (error instanceof Database.SqliteError && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return EMAIL_TAKEN;
    }
    throw error;
  }
}

/** Finds the firm with this id, unless it is soft-deleted. */
export function findActiveFirmById(db: Database.Database, id: string): Firm | undefined {
  return db
    .prepare<{ id: string }, Firm>(
      'SELECT id, name FROM firms WHERE id = @id AND deleted_at IS NULL',
    )
    .get({ id });
}

/** Renames an active firm and returns it; a missing or soft-deleted firm is left alone. */
export function renameFirm(
  db: Database.Database,
  now: string,
  id: string,
  name: string,
): Firm | undefined {
  return db
    .prepare<{ id: string; name: string; now: string }, Firm>(
      `UPDATE firms SET name = @name, updated_at = @now
        WHERE id = @id AND deleted_at IS NULL
        RETURNING id, name`,
    )
    .get({ id, name, now });
}
