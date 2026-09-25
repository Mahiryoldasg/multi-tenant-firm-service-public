import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { normalizeEmail } from '../auth/email.ts';
import { hashPassword } from '../auth/password.ts';
import type { SeedConfig, SeedFirm } from '../config.ts';

const SEED_MARKER = 'seeded_at';

interface SeedUser {
  firmId: string | null;
  role: 'platform_admin' | 'firm_admin';
  email: string;
  passwordHash: string;
}

/**
 * Seeds the platform admin and two firms with their first admins, once. A `meta` marker, not the
 * row counts, records the seed, so deleting the seed firms never triggers a second one.
 */
export async function seedDatabase(db: Database.Database, seed: SeedConfig): Promise<boolean> {
  if (isSeeded(db)) return false;

  // Hash before the transaction: a better-sqlite3 transaction function must be synchronous.
  const [platformAdminHash, firstAdminHash, secondAdminHash] = await Promise.all([
    hashPassword(seed.platformAdmin.password),
    hashPassword(seed.firms[0].adminPassword),
    hashPassword(seed.firms[1].adminPassword),
  ]);

  const seedOnce = db.transaction((now: string) => {
    // Checked again under the write lock, in case another process seeded while this one hashed.
    if (isSeeded(db)) return false;

    insertUser(db, now, {
      firmId: null,
      role: 'platform_admin',
      email: seed.platformAdmin.email,
      passwordHash: platformAdminHash,
    });
    insertFirmWithAdmin(db, now, seed.firms[0], firstAdminHash);
    insertFirmWithAdmin(db, now, seed.firms[1], secondAdminHash);
    db.prepare('INSERT INTO meta (key, value) VALUES (@key, @now)').run({ key: SEED_MARKER, now });
    return true;
  });

  return seedOnce.immediate(new Date().toISOString());
}

function isSeeded(db: Database.Database): boolean {
  return db.prepare('SELECT 1 FROM meta WHERE key = @key').get({ key: SEED_MARKER }) !== undefined;
}

function insertFirmWithAdmin(
  db: Database.Database,
  now: string,
  firm: SeedFirm,
  adminPasswordHash: string,
): void {
  const firmId = randomUUID();
  db.prepare(
    'INSERT INTO firms (id, name, created_at, updated_at) VALUES (@id, @name, @now, @now)',
  ).run({ id: firmId, name: firm.name, now });
  insertUser(db, now, {
    firmId,
    role: 'firm_admin',
    email: firm.adminEmail,
    passwordHash: adminPasswordHash,
  });
}

function insertUser(db: Database.Database, now: string, user: SeedUser): void {
  db.prepare(
    `INSERT INTO users
       (id, firm_id, email, email_normalized, password_hash, role, created_at, updated_at)
     VALUES (@id, @firmId, @email, @emailNormalized, @passwordHash, @role, @now, @now)`,
  ).run({ ...user, id: randomUUID(), emailNormalized: normalizeEmail(user.email), now });
}
