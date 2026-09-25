import type Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createApp } from './app.ts';
import { type AppConfig, loadConfig } from './config.ts';
import { openDatabase } from './db/connection.ts';
import { seedDatabase } from './db/seed.ts';
import { createLogger } from './logger.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

let config: AppConfig;
try {
  config = loadConfig();
} catch (error) {
  console.error(`\n[config] ${(error as Error).message}\n`);
  process.exit(1);
}

const logger = createLogger(config.logLevel);

let db: Database.Database;
let seeded: boolean;
try {
  db = openDatabase(config.dbPath);
  seeded = await seedDatabase(db, config.seed);
} catch (error) {
  console.error(`\n[db] ${(error as Error).message}\n`);
  process.exit(1);
}
logger.info({ dbPath: config.dbPath, seeded }, 'Database ready');

const server = createServer(createApp({ logger }));

server.listen(config.port, () => {
  logger.info({ port: config.port }, `Server ready on http://localhost:${config.port}`);
});

function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, 'Shutting down');
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
