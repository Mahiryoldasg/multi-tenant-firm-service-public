import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeEmail } from '../../src/server/auth/email.ts';
import { verifyPassword } from '../../src/server/auth/password.ts';
import {
  findActiveUserByEmail,
  findActiveUserById,
} from '../../src/server/modules/platform/users.ts';
import { createSeededDatabase } from '../helpers/db.ts';

const DELETED_AT = '2026-09-25T12:00:00.000Z';

let db: Database.Database;

beforeEach(async () => {
  db = await createSeededDatabase();
});

afterEach(() => {
  db.close();
});

function firmId(name: string): string {
  const row = db
    .prepare<{ name: string }, { id: string }>('SELECT id FROM firms WHERE name = @name')
    .get({ name });
  if (!row) throw new Error(`No firm named ${name}`);
  return row.id;
}

function softDeleteUser(emailNormalized: string): void {
  db.prepare('UPDATE users SET deleted_at = @at WHERE email_normalized = @emailNormalized').run({
    at: DELETED_AT,
    emailNormalized,
  });
}

function find(email: string) {
  return findActiveUserByEmail(db, normalizeEmail(email));
}

describe('findActiveUserByEmail', () => {
  it('finds a firm admin by an email in other casing with spaces, in the stored casing', async () => {
    const user = find('  BOSS@first.test\t');

    expect(user).toEqual({
      id: expect.any(String),
      email: 'Boss@First.Test',
      role: 'firm_admin',
      firmId: firmId('First Test Firm'),
      passwordHash: expect.any(String),
    });
    await expect(verifyPassword('first-secret', user?.passwordHash ?? '')).resolves.toBe(true);
  });

  it('finds the platform admin with a null firmId', () => {
    expect(find('root@platform.test')).toMatchObject({
      email: 'Root@Platform.Test',
      role: 'platform_admin',
      firmId: null,
    });
  });

  it('finds nothing for an unknown email', () => {
    expect(find('nobody@first.test')).toBeUndefined();
  });

  it('finds nothing for a soft-deleted user', () => {
    softDeleteUser('boss@first.test');

    expect(find('boss@first.test')).toBeUndefined();
  });

  it.each([
    { label: 'together with its users', deleteUsers: true },
    { label: 'while its users are still active', deleteUsers: false },
  ])('finds nothing for a user of a firm soft-deleted $label', ({ deleteUsers }) => {
    db.prepare('UPDATE firms SET deleted_at = @at WHERE id = @id').run({
      at: DELETED_AT,
      id: firmId('First Test Firm'),
    });
    if (deleteUsers) softDeleteUser('boss@first.test');

    expect(find('boss@first.test')).toBeUndefined();
    expect(find('boss@second.test')).toMatchObject({ role: 'firm_admin' });
  });

  it('finds the new active user once a soft delete freed the email', () => {
    softDeleteUser('boss@first.test');
    const newId = randomUUID();
    db.prepare(
      `INSERT INTO users
         (id, firm_id, email, email_normalized, password_hash, role, created_at, updated_at)
       VALUES (@id, @firmId, 'BOSS@FIRST.TEST', 'boss@first.test', 'unused', 'member', @at, @at)`,
    ).run({ id: newId, firmId: firmId('Second Test Firm'), at: DELETED_AT });

    expect(find('boss@first.test')).toMatchObject({
      id: newId,
      email: 'BOSS@FIRST.TEST',
      role: 'member',
      firmId: firmId('Second Test Firm'),
    });
  });
});

describe('findActiveUserById', () => {
  function idOf(email: string): string {
    const user = find(email);
    if (!user) throw new Error(`No active user ${email}`);
    return user.id;
  }

  it('finds a firm admin in the stored casing, without the password hash', () => {
    const id = idOf('boss@first.test');

    const user = findActiveUserById(db, id);

    expect(user).toEqual({
      id,
      email: 'Boss@First.Test',
      role: 'firm_admin',
      firmId: firmId('First Test Firm'),
    });
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('finds the platform admin with a null firmId', () => {
    expect(findActiveUserById(db, idOf('root@platform.test'))).toEqual({
      id: expect.any(String),
      email: 'Root@Platform.Test',
      role: 'platform_admin',
      firmId: null,
    });
  });

  it('finds nothing for an unknown id', () => {
    expect(findActiveUserById(db, randomUUID())).toBeUndefined();
  });

  it('finds nothing for a soft-deleted user', () => {
    const id = idOf('boss@first.test');
    softDeleteUser('boss@first.test');

    expect(findActiveUserById(db, id)).toBeUndefined();
  });

  it('finds nothing for an active user of a soft-deleted firm', () => {
    const id = idOf('boss@first.test');
    db.prepare('UPDATE firms SET deleted_at = @at WHERE id = @id').run({
      at: DELETED_AT,
      id: firmId('First Test Firm'),
    });

    expect(findActiveUserById(db, id)).toBeUndefined();
    expect(findActiveUserById(db, idOf('boss@second.test'))).toMatchObject({ role: 'firm_admin' });
  });
});
