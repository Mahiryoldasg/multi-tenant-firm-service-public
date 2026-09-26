import type Database from 'better-sqlite3';
import { hashPassword } from '../auth/password.ts';
import type { SeedConfig } from '../config.ts';
import { insertFirmWithAdmin } from '../modules/platform/firms.ts';
import { insertUser } from '../modules/platform/users.ts';

const SEED_MARKER = 'seeded_at';

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
    insertFirmWithAdmin(db, now, {
      name: seed.firms[0].name,
      adminEmail: seed.firms[0].adminEmail,
      adminPasswordHash: firstAdminHash,
    });
    insertFirmWithAdmin(db, now, {
      name: seed.firms[1].name,
      adminEmail: seed.firms[1].adminEmail,
      adminPasswordHash: secondAdminHash,
    });
    db.prepare('INSERT INTO meta (key, value) VALUES (@key, @now)').run({ key: SEED_MARKER, now });
    return true;
  });

  return seedOnce.immediate(new Date().toISOString());
}

function isSeeded(db: Database.Database): boolean {
  return db.prepare('SELECT 1 FROM meta WHERE key = @key').get({ key: SEED_MARKER }) !== undefined;
}
