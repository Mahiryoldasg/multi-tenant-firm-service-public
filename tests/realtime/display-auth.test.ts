import type Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeEmail } from '../../src/server/auth/email.ts';
import { signDisplayToken } from '../../src/server/auth/tokens.ts';
import { softDeleteFirm } from '../../src/server/modules/platform/firms.ts';
import { findActiveUserByEmail, insertUser } from '../../src/server/modules/platform/users.ts';
import {
  authenticateDisplay,
  DISPLAY_TOKEN_REQUIRED_MESSAGE,
  INVALID_DISPLAY_TOKEN_MESSAGE,
  USER_TOKEN_ON_SOCKET_MESSAGE,
} from '../../src/server/realtime/display-auth.ts';
import { createDisplayTokensRepository } from '../../src/server/tenancy/display-tokens.ts';
import { TEST_CONFIG } from '../helpers/app.ts';
import { userTokenFor } from '../helpers/auth.ts';
import { createSeededDatabase, TEST_SEED } from '../helpers/db.ts';

const SECRET = TEST_CONFIG.jwtSecret;
const NOW = '2026-09-27T12:00:00.000Z';
const FIRST_ADMIN_EMAIL = TEST_SEED.firms[0].adminEmail;
const FIRST_MEMBER_EMAIL = 'Member@First.Test';

let db: Database.Database;
let firstFirmId: string;
let secondFirmId: string;

beforeEach(async () => {
  db = await createSeededDatabase();
  firstFirmId = firmId('First Test Firm');
  secondFirmId = firmId('Second Test Firm');
});

afterEach(() => {
  if (db.open) db.close();
});

function firmId(name: string): string {
  const row = db
    .prepare<{ name: string }, { id: string }>('SELECT id FROM firms WHERE name = @name')
    .get({ name });
  if (!row) throw new Error(`No firm named ${name}`);
  return row.id;
}

function check(token: unknown) {
  return authenticateDisplay({ token }, { db, secret: SECRET });
}

function displayTokenOf(id: string): string {
  return signDisplayToken({ id: randomUUID(), firmId: id }, SECRET);
}

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('authenticateDisplay accepts', () => {
  it("a display token of each seed firm, as that firm's id", () => {
    expect(check(displayTokenOf(firstFirmId))).toEqual({ ok: true, firmId: firstFirmId });
    expect(check(displayTokenOf(secondFirmId))).toEqual({ ok: true, firmId: secondFirmId });
  });

  it('a display token whose issuer was deleted since', () => {
    const issuer = findActiveUserByEmail(db, normalizeEmail(FIRST_ADMIN_EMAIL));
    if (!issuer) throw new Error('No first firm admin');
    const issued = createDisplayTokensRepository(db, firstFirmId).create(NOW, {
      label: null,
      createdByUserId: issuer.id,
    });
    if (!issued) throw new Error('No display token row');
    db.prepare('UPDATE users SET deleted_at = @now WHERE id = @id').run({
      id: issuer.id,
      now: NOW,
    });

    expect(check(signDisplayToken(issued, SECRET))).toEqual({ ok: true, firmId: firstFirmId });
  });
});

describe('authenticateDisplay rejects a missing token', () => {
  it.each([
    { label: 'no auth at all', auth: undefined },
    { label: 'auth without a token', auth: {} },
    { label: 'a number', auth: { token: 42 } },
    { label: 'an empty string', auth: { token: '' } },
    { label: 'a blank string', auth: { token: '   ' } },
  ])('given $label', ({ auth }) => {
    expect(authenticateDisplay(auth, { db, secret: SECRET })).toEqual({
      ok: false,
      message: DISPLAY_TOKEN_REQUIRED_MESSAGE,
    });
  });
});

describe('authenticateDisplay rejects a user token', () => {
  it('of a firm admin', () => {
    expect(check(userTokenFor(db, FIRST_ADMIN_EMAIL))).toEqual({
      ok: false,
      message: USER_TOKEN_ON_SOCKET_MESSAGE,
    });
  });

  it('of a member', () => {
    insertUser(db, NOW, {
      firmId: firstFirmId,
      role: 'member',
      email: FIRST_MEMBER_EMAIL,
      passwordHash: 'unused',
    });

    expect(check(userTokenFor(db, FIRST_MEMBER_EMAIL))).toEqual({
      ok: false,
      message: USER_TOKEN_ON_SOCKET_MESSAGE,
    });
  });

  it('of the platform admin', () => {
    expect(check(userTokenFor(db, TEST_SEED.platformAdmin.email))).toEqual({
      ok: false,
      message: USER_TOKEN_ON_SOCKET_MESSAGE,
    });
  });

  it.each([
    { label: 'a sub', extra: { sub: 'user-1' } },
    { label: 'a role', extra: { role: 'firm_admin' } },
  ])('shaped like a display token but carrying $label', ({ extra }) => {
    const token = jwt.sign({ kind: 'display', firmId: firstFirmId, ...extra }, SECRET, {
      algorithm: 'HS256',
    });

    expect(check(token)).toEqual({ ok: false, message: USER_TOKEN_ON_SOCKET_MESSAGE });
  });
});

describe('authenticateDisplay rejects an invalid token', () => {
  it.each([
    { label: 'that is not a JWT', token: () => 'not.a.jwt' },
    {
      label: 'signed with another secret',
      token: () => signDisplayToken({ id: randomUUID(), firmId: firstFirmId }, 'other-secret'),
    },
    {
      label: 'signed HS512 with the right secret',
      token: () =>
        jwt.sign({ kind: 'display', firmId: firstFirmId }, SECRET, { algorithm: 'HS512' }),
    },
    {
      label: 'unsigned with alg none',
      token: () =>
        `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({ kind: 'display', firmId: firstFirmId })}.`,
    },
    {
      label: 'with another kind',
      token: () => jwt.sign({ kind: 'kiosk', firmId: firstFirmId }, SECRET, { algorithm: 'HS256' }),
    },
    {
      label: 'with no kind',
      token: () => jwt.sign({ firmId: firstFirmId }, SECRET, { algorithm: 'HS256' }),
    },
    {
      label: 'with no firmId',
      token: () => jwt.sign({ kind: 'display' }, SECRET, { algorithm: 'HS256' }),
    },
    {
      label: 'with a non-string firmId',
      token: () => jwt.sign({ kind: 'display', firmId: 42 }, SECRET, { algorithm: 'HS256' }),
    },
    { label: 'of an unknown firm', token: () => displayTokenOf(randomUUID()) },
  ])('$label', ({ token }) => {
    expect(check(token())).toEqual({ ok: false, message: INVALID_DISPLAY_TOKEN_MESSAGE });
  });

  it('of a soft-deleted firm', () => {
    const token = displayTokenOf(firstFirmId);
    softDeleteFirm(db, NOW, firstFirmId);

    expect(check(token)).toEqual({ ok: false, message: INVALID_DISPLAY_TOKEN_MESSAGE });
    expect(check(displayTokenOf(secondFirmId))).toEqual({ ok: true, firmId: secondFirmId });
  });
});
