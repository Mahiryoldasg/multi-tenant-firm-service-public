import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { insertUser } from './users.ts';

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

/** A created firm and its first admin, in the shape `POST /api/firms` returns. */
export interface CreatedFirm {
  firm: { id: string; name: string };
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
