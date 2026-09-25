import type Database from 'better-sqlite3';

// TEXT primary keys need NOT NULL: SQLite otherwise accepts NULL in any primary key that is not
// INTEGER PRIMARY KEY.
const INITIAL_SCHEMA = `
  CREATE TABLE firms (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    active_mode_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE users (
    id TEXT PRIMARY KEY NOT NULL,
    firm_id TEXT REFERENCES firms (id),
    email TEXT NOT NULL,
    email_normalized TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('platform_admin', 'firm_admin', 'member')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    CHECK (
      (role = 'platform_admin' AND firm_id IS NULL)
      OR (role <> 'platform_admin' AND firm_id IS NOT NULL)
    )
  );

  -- Only active users count, so a soft-deleted user's email can be used again.
  CREATE UNIQUE INDEX users_email_normalized_active
    ON users (email_normalized) WHERE deleted_at IS NULL;

  CREATE INDEX users_firm_id_deleted_at ON users (firm_id, deleted_at);

  CREATE TABLE display_tokens (
    id TEXT PRIMARY KEY NOT NULL,
    firm_id TEXT NOT NULL REFERENCES firms (id),
    label TEXT,
    created_by_user_id TEXT NOT NULL REFERENCES users (id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
`;

// Entry i is migration i + 1; PRAGMA user_version stores how many have been applied.
// TypeScript strings instead of .sql files so `tsc` carries them into dist/server.
export const MIGRATIONS: readonly string[] = [INITIAL_SCHEMA];

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
