import type Database from 'better-sqlite3';

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
