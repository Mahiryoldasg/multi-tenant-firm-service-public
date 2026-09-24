import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyPassword } from '../../src/server/auth/password.ts';
import type { SeedConfig } from '../../src/server/config.ts';
import { openDatabase } from '../../src/server/db/connection.ts';
import { seedDatabase } from '../../src/server/db/seed.ts';

// Deliberately not the .env.example values, so the tests prove the seed reads its config.
const SEED: SeedConfig = {
  platformAdmin: { email: 'Root@Platform.Test', password: 'platform-secret' },
  firms: [
    { name: 'First Test Firm', adminEmail: 'Boss@First.Test', adminPassword: 'first-secret' },
    { name: 'Second Test Firm', adminEmail: 'boss@second.test', adminPassword: 'second-secret' },
  ],
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DELETED_AT = '2026-09-25T12:00:00.000Z';

interface Row {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface FirmRow extends Row {
  name: string;
  active_mode_id: string | null;
}

interface UserRow extends Row {
  firm_id: string | null;
  email: string;
  email_normalized: string;
  password_hash: string;
  role: string;
}

function firmRows(db: Database.Database): FirmRow[] {
  return db.prepare<[], FirmRow>('SELECT * FROM firms ORDER BY rowid').all();
}

function userRows(db: Database.Database): UserRow[] {
  return db.prepare<[], UserRow>('SELECT * FROM users ORDER BY rowid').all();
}

function rowCounts(db: Database.Database): unknown {
  return db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM firms) AS firms,
              (SELECT COUNT(*) FROM users) AS users,
              (SELECT COUNT(*) FROM meta) AS markers`,
    )
    .get();
}

describe('seedDatabase', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates the configured platform admin, two firms and one firm admin each', async () => {
    await expect(seedDatabase(db, SEED)).resolves.toBe(true);

    const firms = firmRows(db);
    const users = userRows(db).map((user) => ({
      role: user.role,
      firmId: user.firm_id,
      email: user.email,
      emailNormalized: user.email_normalized,
    }));
    expect(firms.map((firm) => firm.name)).toEqual(['First Test Firm', 'Second Test Firm']);
    expect(users).toEqual([
      {
        role: 'platform_admin',
        firmId: null,
        email: 'Root@Platform.Test',
        emailNormalized: 'root@platform.test',
      },
      {
        role: 'firm_admin',
        firmId: firms[0]?.id,
        email: 'Boss@First.Test',
        emailNormalized: 'boss@first.test',
      },
      {
        role: 'firm_admin',
        firmId: firms[1]?.id,
        email: 'boss@second.test',
        emailNormalized: 'boss@second.test',
      },
    ]);
  });

  it('stores UUID ids and one UTC timestamp, with no mode, deletion or display token', async () => {
    await seedDatabase(db, SEED);

    const marker = db
      .prepare<[], { value: string }>("SELECT value FROM meta WHERE key = 'seeded_at'")
      .get();
    expect(marker?.value).toMatch(ISO_UTC);
    for (const row of [...firmRows(db), ...userRows(db)]) {
      expect(row.id).toMatch(UUID_V4);
      expect([row.created_at, row.updated_at, row.deleted_at]).toEqual([
        marker?.value,
        marker?.value,
        null,
      ]);
    }
    expect(firmRows(db).map((firm) => firm.active_mode_id)).toEqual([null, null]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM display_tokens').get()).toEqual({ count: 0 });
  });

  it('hashes each password so that it matches its own password only', async () => {
    await seedDatabase(db, SEED);

    const passwords = ['platform-secret', 'first-secret', 'second-secret'];
    const matches = await Promise.all(
      userRows(db).map((user) =>
        Promise.all(passwords.map((password) => verifyPassword(password, user.password_hash))),
      ),
    );

    expect(matches).toEqual([
      [true, false, false],
      [false, true, false],
      [false, false, true],
    ]);
  });

  it('does nothing on a second run', async () => {
    await seedDatabase(db, SEED);

    await expect(seedDatabase(db, SEED)).resolves.toBe(false);
    expect(rowCounts(db)).toEqual({ firms: 2, users: 3, markers: 1 });
  });

  it('does not seed again after the seed firms and their users are deleted', async () => {
    await seedDatabase(db, SEED);
    db.prepare('UPDATE firms SET deleted_at = @now').run({ now: DELETED_AT });
    db.prepare('UPDATE users SET deleted_at = @now WHERE firm_id IS NOT NULL').run({
      now: DELETED_AT,
    });

    await expect(seedDatabase(db, SEED)).resolves.toBe(false);
    expect(rowCounts(db)).toEqual({ firms: 2, users: 3, markers: 1 });
  });

  it('rolls back everything, marker included, when an insert fails', async () => {
    const clashing: SeedConfig = {
      ...SEED,
      firms: [SEED.firms[0], { ...SEED.firms[1], adminEmail: 'ROOT@platform.test' }],
    };

    await expect(seedDatabase(db, clashing)).rejects.toThrow(/UNIQUE constraint failed/);
    expect(rowCounts(db)).toEqual({ firms: 0, users: 0, markers: 0 });

    // Nothing was left behind, so the next boot seeds normally.
    await expect(seedDatabase(db, SEED)).resolves.toBe(true);
    expect(rowCounts(db)).toEqual({ firms: 2, users: 3, markers: 1 });
  });
});

describe('seedDatabase on a database file', () => {
  const connections: Database.Database[] = [];
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'mtfs-'));
  });

  afterEach(() => {
    // Close before deleting: Windows keeps an open database file locked.
    for (const connection of connections.splice(0)) {
      if (connection.open) connection.close();
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  function boot(dbPath: string): Database.Database {
    const db = openDatabase(dbPath);
    connections.push(db);
    return db;
  }

  it('seeds once across two boots on the same file', async () => {
    const dbPath = path.join(tempDir, 'data', 'app.db');

    const firstBoot = boot(dbPath);
    await expect(seedDatabase(firstBoot, SEED)).resolves.toBe(true);
    firstBoot.close();

    const secondBoot = boot(dbPath);
    await expect(seedDatabase(secondBoot, SEED)).resolves.toBe(false);
    expect(rowCounts(secondBoot)).toEqual({ firms: 2, users: 3, markers: 1 });
  });
});
