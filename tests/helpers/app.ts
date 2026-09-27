import type Database from 'better-sqlite3';
import type { Express } from 'express';
import { pino, type Logger } from 'pino';
import { createApp } from '../../src/server/app.ts';
import { createRealtime, type Realtime } from '../../src/server/realtime/realtime.ts';
import { createSeededDatabase } from './db.ts';

export const TEST_CONFIG = { jwtSecret: 'test-secret', userTokenTtlSeconds: 43200 };

/**
 * The real app on a fresh, seeded in-memory database; silent unless a logger is passed. Its display
 * channel is unattached: the realtime tests attach it to a listening server.
 */
export async function createTestApp({
  logger = pino({ level: 'silent' }),
}: { logger?: Logger } = {}): Promise<{
  app: Express;
  db: Database.Database;
  realtime: Realtime;
}> {
  const db = await createSeededDatabase();
  const realtime = createRealtime({ db, config: TEST_CONFIG, logger });
  return { app: createApp({ logger, db, config: TEST_CONFIG, realtime }), db, realtime };
}
