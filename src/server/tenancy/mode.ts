import type Database from 'better-sqlite3';

/** The active mode of one firm. No method takes a firm id: the firm is fixed at construction. */
export interface ModeRepository {
  /**
   * The firm's active `modeId` as stored, or `null` when none was ever set. A deleted firm also
   * reads as `null`, which `authenticate` makes unreachable: it rejects the firm's users first.
   */
  get(): string | null;
  /**
   * Stores `modeId` exactly as given, the current value included, and returns true. Returns false,
   * changing nothing, when the firm is no longer active.
   */
  set(now: string, modeId: string): boolean;
}

/** Binds the mode statements to `firmId`; every statement filters on it. */
export function createModeRepository(db: Database.Database, firmId: string): ModeRepository {
  return {
    get() {
      const row = db
        .prepare<{ firmId: string }, { modeId: string | null }>(
          `SELECT active_mode_id AS modeId
             FROM firms
            WHERE id = @firmId
              AND deleted_at IS NULL`,
        )
        .get({ firmId });
      return row?.modeId ?? null;
    },

    set(now, modeId) {
      const result = db
        .prepare<{ firmId: string; modeId: string; now: string }>(
          `UPDATE firms SET active_mode_id = @modeId, updated_at = @now
            WHERE id = @firmId
              AND deleted_at IS NULL`,
        )
        .run({ firmId, modeId, now });
      return result.changes > 0;
    },
  };
}
