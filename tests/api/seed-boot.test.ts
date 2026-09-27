import type Database from 'better-sqlite3';
import type { Express } from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pino } from 'pino';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.ts';
import { openDatabase } from '../../src/server/db/connection.ts';
import { seedDatabase } from '../../src/server/db/seed.ts';
import { createRealtime } from '../../src/server/realtime/realtime.ts';
import { TEST_CONFIG } from '../helpers/app.ts';
import { TEST_SEED } from '../helpers/db.ts';

// Contract §1: a second start on the same database adds no firm and no user. This mirrors that
// through the public API; tests/db/seed.test.ts covers the seed function itself.

const connections: Database.Database[] = [];
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'mtfs-boot-'));
});

afterEach(() => {
  // Close before deleting: Windows keeps an open database file locked.
  for (const connection of connections.splice(0)) {
    if (connection.open) connection.close();
  }
  rmSync(tempDir, { recursive: true, force: true });
});

/** The start-up steps of `index.ts`, without listening: open and migrate, seed, build the app. */
async function boot(dbPath: string): Promise<{ app: Express; db: Database.Database }> {
  const logger = pino({ level: 'silent' });
  const db = openDatabase(dbPath);
  connections.push(db);
  await seedDatabase(db, TEST_SEED);
  const realtime = createRealtime({ db, config: TEST_CONFIG, logger });
  return { app: createApp({ logger, db, config: TEST_CONFIG, realtime }), db };
}

async function login(app: Express, email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return (res.body as { token: string }).token;
}

async function get(app: Express, path: string, token: string): Promise<unknown> {
  const res = await request(app).get(path).set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body;
}

/** What the seed accounts see: the firm list, and each seed firm admin's employee list. */
async function observe(app: Express) {
  const { email, password } = TEST_SEED.platformAdmin;
  const { firms } = (await get(app, '/api/firms', await login(app, email, password))) as {
    firms: { id: string; name: string }[];
  };
  const employeeLists = [];
  for (const { adminEmail, adminPassword } of TEST_SEED.firms) {
    const token = await login(app, adminEmail, adminPassword);
    employeeLists.push(await get(app, '/api/employees', token));
  }
  return { firms: firms.map(({ id, name }) => ({ id, name })), employeeLists };
}

function count(db: Database.Database, table: 'firms' | 'users'): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

describe('two boots on the same database file', () => {
  it('seed once: the same firms and accounts, and no new rows', async () => {
    const dbPath = path.join(tempDir, 'data', 'app.db');

    const firstBoot = await boot(dbPath);
    const afterFirstBoot = await observe(firstBoot.app);
    firstBoot.db.close();

    const secondBoot = await boot(dbPath);
    const afterSecondBoot = await observe(secondBoot.app);

    expect(afterFirstBoot).toEqual({
      firms: TEST_SEED.firms.map(({ name }) => ({ id: expect.any(String), name })),
      employeeLists: TEST_SEED.firms.map(({ adminEmail }) => ({
        employees: [{ id: expect.any(String), email: adminEmail, role: 'firm_admin' }],
      })),
    });
    expect(afterSecondBoot).toEqual(afterFirstBoot);
    expect(count(secondBoot.db, 'firms')).toBe(2);
    expect(count(secondBoot.db, 'users')).toBe(3);
  });
});
