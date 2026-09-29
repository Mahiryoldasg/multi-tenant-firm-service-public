import type Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeEmail } from '../../src/server/auth/email.ts';
import { signDisplayToken, signUserToken } from '../../src/server/auth/tokens.ts';
import {
  AUTH_REQUIRED_MESSAGE,
  INVALID_SESSION_MESSAGE,
} from '../../src/server/http/authenticate.ts';
import { FORBIDDEN_MESSAGE } from '../../src/server/http/authorize.ts';
import { softDeleteFirm } from '../../src/server/modules/platform/firms.ts';
import { findActiveUserByEmail, insertUser } from '../../src/server/modules/platform/users.ts';
import {
  authenticateControl,
  DISPLAY_TOKEN_ON_CONTROL_MESSAGE,
} from '../../src/server/realtime/control-auth.ts';
import { TEST_CONFIG } from '../helpers/app.ts';
import { userTokenFor } from '../helpers/auth.ts';
import { createSeededDatabase, TEST_SEED } from '../helpers/db.ts';

const SECRET = TEST_CONFIG.jwtSecret;
const NOW = '2026-09-29T12:00:00.000Z';
const FIRST_ADMIN_EMAIL = TEST_SEED.firms[0].adminEmail;
const SECOND_ADMIN_EMAIL = TEST_SEED.firms[1].adminEmail;
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

function userId(email: string): string {
  const user = findActiveUserByEmail(db, normalizeEmail(email));
  if (!user) throw new Error(`No active user ${email}`);
  return user.id;
}

function check(token: unknown) {
  return authenticateControl({ token }, { db, secret: SECRET });
}

function signed(claims: object): string {
  return jwt.sign(claims, SECRET, { algorithm: 'HS256' });
}

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function addFirstMember(): void {
  insertUser(db, NOW, {
    firmId: firstFirmId,
    role: 'member',
    email: FIRST_MEMBER_EMAIL,
    passwordHash: 'unused',
  });
}

describe('authenticateControl accepts', () => {
  it("the firm admin of each seed firm, as that firm's id", () => {
    expect(check(userTokenFor(db, FIRST_ADMIN_EMAIL))).toEqual({ ok: true, firmId: firstFirmId });
    expect(check(userTokenFor(db, SECOND_ADMIN_EMAIL))).toEqual({
      ok: true,
      firmId: secondFirmId,
    });
  });

  it("a member, as the member's firm id", () => {
    addFirstMember();

    expect(check(userTokenFor(db, FIRST_MEMBER_EMAIL))).toEqual({ ok: true, firmId: firstFirmId });
  });

  it("the user's own firm from the DB when the firmId and role claims say otherwise", () => {
    const token = signUserToken(
      { id: userId(FIRST_ADMIN_EMAIL), role: 'platform_admin', firmId: secondFirmId },
      { secret: SECRET, ttlSeconds: TEST_CONFIG.userTokenTtlSeconds },
    );

    expect(check(token)).toEqual({ ok: true, firmId: firstFirmId });
  });
});

describe('authenticateControl rejects a missing token', () => {
  it.each([
    { label: 'no auth at all', auth: undefined },
    { label: 'auth without a token', auth: {} },
    { label: 'a number', auth: { token: 42 } },
    { label: 'an empty string', auth: { token: '' } },
    { label: 'a blank string', auth: { token: '   ' } },
  ])('given $label', ({ auth }) => {
    expect(authenticateControl(auth, { db, secret: SECRET })).toEqual({
      ok: false,
      message: AUTH_REQUIRED_MESSAGE,
    });
  });
});

describe('authenticateControl rejects a display token', () => {
  it('of the same firm', () => {
    const token = signDisplayToken({ id: randomUUID(), firmId: firstFirmId }, SECRET);

    expect(check(token)).toEqual({ ok: false, message: DISPLAY_TOKEN_ON_CONTROL_MESSAGE });
  });

  it('that also carries a user sub', () => {
    const token = signed({ kind: 'display', firmId: firstFirmId, sub: userId(FIRST_ADMIN_EMAIL) });

    expect(check(token)).toEqual({ ok: false, message: DISPLAY_TOKEN_ON_CONTROL_MESSAGE });
  });
});

describe('authenticateControl rejects an invalid session', () => {
  it.each([
    { label: 'a token that is not a JWT', token: () => 'not.a.jwt' },
    {
      label: 'a token signed with another secret',
      token: () =>
        signUserToken(
          { id: userId(FIRST_ADMIN_EMAIL), role: 'firm_admin', firmId: firstFirmId },
          { secret: 'other-secret', ttlSeconds: TEST_CONFIG.userTokenTtlSeconds },
        ),
    },
    {
      label: 'a token signed HS512 with the right secret',
      token: () =>
        jwt.sign({ sub: userId(FIRST_ADMIN_EMAIL), role: 'firm_admin' }, SECRET, {
          algorithm: 'HS512',
        }),
    },
    {
      label: 'an unsigned token with alg none',
      token: () =>
        `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({ sub: userId(FIRST_ADMIN_EMAIL) })}.`,
    },
    {
      label: 'an expired token',
      token: () =>
        signed({
          sub: userId(FIRST_ADMIN_EMAIL),
          role: 'firm_admin',
          exp: Math.floor(Date.now() / 1000) - 60,
        }),
    },
    {
      label: 'a token with another kind',
      token: () => signed({ kind: 'kiosk', sub: userId(FIRST_ADMIN_EMAIL) }),
    },
    { label: 'a token with no sub', token: () => signed({ role: 'firm_admin' }) },
    { label: 'a token with a non-string sub', token: () => signed({ sub: 42 }) },
    { label: 'a token of an unknown user', token: () => signed({ sub: randomUUID() }) },
  ])('given $label', ({ token }) => {
    expect(check(token())).toEqual({ ok: false, message: INVALID_SESSION_MESSAGE });
  });

  it('of a soft-deleted user', () => {
    addFirstMember();
    const token = userTokenFor(db, FIRST_MEMBER_EMAIL);
    db.prepare('UPDATE users SET deleted_at = @now WHERE id = @id').run({
      id: userId(FIRST_MEMBER_EMAIL),
      now: NOW,
    });

    expect(check(token)).toEqual({ ok: false, message: INVALID_SESSION_MESSAGE });
  });

  it('of a user of a soft-deleted firm', () => {
    const token = userTokenFor(db, FIRST_ADMIN_EMAIL);
    softDeleteFirm(db, NOW, firstFirmId);

    expect(check(token)).toEqual({ ok: false, message: INVALID_SESSION_MESSAGE });
    expect(check(userTokenFor(db, SECOND_ADMIN_EMAIL))).toEqual({
      ok: true,
      firmId: secondFirmId,
    });
  });
});

describe('authenticateControl rejects the platform admin', () => {
  it('with the 403 message, since there is no firm to follow', () => {
    expect(check(userTokenFor(db, TEST_SEED.platformAdmin.email))).toEqual({
      ok: false,
      message: FORBIDDEN_MESSAGE,
    });
  });
});
