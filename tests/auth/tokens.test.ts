import jwt, { type JwtPayload } from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signUserToken, verifyToken } from '../../src/server/auth/tokens.ts';

const OPTIONS = { secret: 'test-secret', ttlSeconds: 43200 };
const FIRM_ADMIN = { id: 'user-1', role: 'firm_admin', firmId: 'firm-1' } as const;
const PLATFORM_ADMIN = { id: 'root-1', role: 'platform_admin', firmId: null } as const;

function verify(token: string): JwtPayload {
  return jwt.verify(token, OPTIONS.secret, { algorithms: ['HS256'] }) as JwtPayload;
}

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('signUserToken', () => {
  it('signs with HS256', () => {
    const decoded = jwt.decode(signUserToken(FIRM_ADMIN, OPTIONS), { complete: true });

    expect(decoded?.header).toEqual({ alg: 'HS256', typ: 'JWT' });
  });

  it('carries exactly sub, role and firmId for a firm user', () => {
    const payload = verify(signUserToken(FIRM_ADMIN, OPTIONS));

    expect(payload).toEqual({
      sub: 'user-1',
      role: 'firm_admin',
      firmId: 'firm-1',
      iat: expect.any(Number),
      exp: expect.any(Number),
    });
  });

  it('omits firmId, rather than sending null, for the platform admin', () => {
    const payload = verify(signUserToken(PLATFORM_ADMIN, OPTIONS));

    expect(payload).not.toHaveProperty('firmId');
    expect(payload).toEqual({
      sub: 'root-1',
      role: 'platform_admin',
      iat: expect.any(Number),
      exp: expect.any(Number),
    });
  });

  it.each([43200, 90])('expires %i seconds after it was issued', (ttlSeconds) => {
    const payload = verify(signUserToken(FIRM_ADMIN, { ...OPTIONS, ttlSeconds }));

    expect(Number(payload.exp) - Number(payload.iat)).toBe(ttlSeconds);
  });

  it('does not verify with another secret', () => {
    const token = signUserToken(FIRM_ADMIN, OPTIONS);

    expect(() => jwt.verify(token, 'other-secret', { algorithms: ['HS256'] })).toThrow(
      jwt.JsonWebTokenError,
    );
  });
});

describe('verifyToken', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the claims of a user token', () => {
    const claims = verifyToken(signUserToken(FIRM_ADMIN, OPTIONS), OPTIONS.secret);

    expect(claims).toEqual({
      sub: 'user-1',
      role: 'firm_admin',
      firmId: 'firm-1',
      iat: expect.any(Number),
      exp: expect.any(Number),
    });
  });

  it('returns the claims of a display-shaped token, leaving the kind check to the caller', () => {
    const token = jwt.sign({ kind: 'display', firmId: 'firm-1' }, OPTIONS.secret, {
      algorithm: 'HS256',
      jwtid: 'jti-1',
    });

    expect(verifyToken(token, OPTIONS.secret)).toEqual({
      kind: 'display',
      firmId: 'firm-1',
      iat: expect.any(Number),
      jti: 'jti-1',
    });
  });

  it.each([
    {
      label: 'signed with another secret',
      token: () => signUserToken(FIRM_ADMIN, { ...OPTIONS, secret: 'other-secret' }),
    },
    {
      label: 'signed HS512 with the right secret',
      token: () =>
        jwt.sign({ sub: 'user-1', role: 'firm_admin' }, OPTIONS.secret, { algorithm: 'HS512' }),
    },
    {
      label: 'unsigned with alg none',
      token: () =>
        `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({ sub: 'user-1', role: 'firm_admin' })}.`,
    },
    { label: 'not a JWT at all', token: () => 'not.a.jwt' },
    {
      // jws JSON-parses the payload when the header says `typ: 'JWT'`, before any signature check.
      label: 'with typ JWT and a non-JSON payload',
      token: () =>
        `${base64url({ alg: 'HS256', typ: 'JWT' })}.${Buffer.from('not json').toString('base64url')}.sig`,
    },
    {
      label: 'a string payload signed with the right secret',
      token: () => jwt.sign('just-a-string', OPTIONS.secret, { algorithm: 'HS256' }),
    },
  ])('returns undefined for a token $label', ({ token }) => {
    expect(verifyToken(token(), OPTIONS.secret)).toBeUndefined();
  });

  it('returns undefined once the token has expired', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const token = signUserToken(FIRM_ADMIN, { ...OPTIONS, ttlSeconds: 60 });
    expect(verifyToken(token, OPTIONS.secret)).toBeDefined();

    vi.setSystemTime(Date.now() + 61_000);

    expect(verifyToken(token, OPTIONS.secret)).toBeUndefined();
  });
});
