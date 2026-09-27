import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

/** A display token to record. The label is stored as sent; the issuer is kept for audit only. */
export interface NewDisplayToken {
  label: string | null;
  createdByUserId: string;
}

/** What a display token is signed from: its row id (the `jti`) and its firm. */
export interface IssuedDisplayToken {
  id: string;
  firmId: string;
}

/** The display tokens of one firm. No method takes a firm id: the firm is fixed at construction. */
export interface DisplayTokensRepository {
  /**
   * Records a display token of this firm and returns what to sign. Returns `undefined`, writing
   * nothing, when the firm is no longer active. The token string itself is never stored.
   */
  create(now: string, displayToken: NewDisplayToken): IssuedDisplayToken | undefined;
}

/** Binds the display token statements to `firmId`; every statement filters on it. */
export function createDisplayTokensRepository(
  db: Database.Database,
  firmId: string,
): DisplayTokensRepository {
  return {
    create(now, displayToken) {
      const id = randomUUID();
      // One statement: the row is written only while the firm is active.
      const result = db
        .prepare<{
          id: string;
          firmId: string;
          label: string | null;
          createdByUserId: string;
          now: string;
        }>(
          `INSERT INTO display_tokens (id, firm_id, label, created_by_user_id, created_at)
           SELECT @id, id, @label, @createdByUserId, @now
             FROM firms
            WHERE id = @firmId
              AND deleted_at IS NULL`,
        )
        .run({ id, firmId, now, ...displayToken });
      return result.changes === 1 ? { id, firmId } : undefined;
    },
  };
}
