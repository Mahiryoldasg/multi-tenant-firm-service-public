import type Database from 'better-sqlite3';

// Entry i is migration i + 1; PRAGMA user_version stores how many have been applied.
// TypeScript strings instead of .sql files so `tsc` carries them into dist/server.
export const MIGRATIONS: readonly string[] = [];

/** Applies the pending migrations in order and returns the resulting schema version. */
export function migrate(db: Database.Database, migrations: readonly string[] = MIGRATIONS): number {
  let version = Number(db.pragma('user_version', { simple: true }));

  for (const sql of migrations.slice(version)) {
    const next = version + 1;
    db.transaction(() => {
      db.exec(sql);
      // PRAGMA cannot take a bound parameter; `next` is an integer computed here, never input.
      db.pragma(`user_version = ${next}`);
    })();
    version = next;
  }

  return version;
}
