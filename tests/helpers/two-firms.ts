import type Database from 'better-sqlite3';
import type { Express } from 'express';
import request from 'supertest';
import { normalizeEmail } from '../../src/server/auth/email.ts';
import { findActiveUserByEmail } from '../../src/server/modules/platform/users.ts';
import { userTokenFor } from './auth.ts';
import { TEST_SEED } from './db.ts';

/** A signed-in user: their id, credentials and a valid token. */
export interface Actor {
  id: string;
  email: string;
  password: string;
  token: string;
}

/** A seed firm with its seed admin and one member. */
export interface FirmActors {
  firmId: string;
  admin: Actor;
  member: Actor;
}

export interface TwoFirms {
  platformAdminToken: string;
  first: FirmActors;
  second: FirmActors;
}

// Mixed casing on purpose, like the seed emails in TEST_SEED.
const MEMBERS = [
  { email: 'Member@First.Test', password: 'first-member-secret' },
  { email: 'member@second.test', password: 'second-member-secret' },
] as const;

/**
 * Both seed firms, each with its seed admin and a member created through the real
 * `POST /api/employees`, so every actor can also log in with their password.
 */
export async function setUpTwoFirms({
  app,
  db,
}: {
  app: Express;
  db: Database.Database;
}): Promise<TwoFirms> {
  const [firstSeed, secondSeed] = TEST_SEED.firms;
  const [first, second] = await Promise.all([
    setUpFirm(app, db, firstSeed, MEMBERS[0]),
    setUpFirm(app, db, secondSeed, MEMBERS[1]),
  ]);
  return {
    platformAdminToken: userTokenFor(db, TEST_SEED.platformAdmin.email),
    first,
    second,
  };
}

async function setUpFirm(
  app: Express,
  db: Database.Database,
  seed: { adminEmail: string; adminPassword: string },
  member: { email: string; password: string },
): Promise<FirmActors> {
  const adminUser = findActiveUserByEmail(db, normalizeEmail(seed.adminEmail));
  if (!adminUser?.firmId) throw new Error(`No seed admin ${seed.adminEmail}`);
  const admin: Actor = {
    id: adminUser.id,
    email: seed.adminEmail,
    password: seed.adminPassword,
    token: userTokenFor(db, seed.adminEmail),
  };

  const res = await request(app)
    .post('/api/employees')
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ ...member, role: 'member' });
  if (res.status !== 201) throw new Error(`Creating ${member.email} answered ${res.status}`);
  const { id } = (res.body as { employee: { id: string } }).employee;

  return {
    firmId: adminUser.firmId,
    admin,
    member: { id, ...member, token: userTokenFor(db, member.email) },
  };
}
