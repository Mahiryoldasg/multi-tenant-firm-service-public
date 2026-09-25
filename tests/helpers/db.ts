import type Database from 'better-sqlite3';
import type { SeedConfig } from '../../src/server/config.ts';
import { openDatabase } from '../../src/server/db/connection.ts';
import { seedDatabase } from '../../src/server/db/seed.ts';

// Deliberately not the .env.example values, and with mixed-case emails, so tests prove that
// lookups normalize and responses keep the stored casing.
export const TEST_SEED: SeedConfig = {
  platformAdmin: { email: 'Root@Platform.Test', password: 'platform-secret' },
  firms: [
    { name: 'First Test Firm', adminEmail: 'Boss@First.Test', adminPassword: 'first-secret' },
    { name: 'Second Test Firm', adminEmail: 'boss@second.test', adminPassword: 'second-secret' },
  ],
};

/** A fresh in-memory database with the schema and the TEST_SEED rows. */
export async function createSeededDatabase(): Promise<Database.Database> {
  const db = openDatabase(':memory:');
  await seedDatabase(db, TEST_SEED);
  return db;
}
