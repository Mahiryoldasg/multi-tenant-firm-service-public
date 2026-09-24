// Deletes the SQLite database so the next start re-creates the schema and runs the seed again.
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

if (existsSync('.env')) process.loadEnvFile('.env');

const dbPath = path.resolve(process.env.DB_PATH || './data/app.db');

for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
  rmSync(file, { force: true });
}

console.log(`[db-reset] Removed ${dbPath} (a fresh, seeded database is created on next start)`);
