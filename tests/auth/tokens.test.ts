import jwt, { type JwtPayload } from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { signUserToken } from '../../src/server/auth/tokens.ts';

const OPTIONS = { secret: 'test-secret', ttlSeconds: 43200 };
const FIRM_ADMIN = { id: 'user-1', role: 'firm_admin', firmId: 'firm-1' } as const;
const PLATFORM_ADMIN = { id: 'root-1', role: 'platform_admin', firmId: null } as const;

function verify(token: string): JwtPayload {
  return jwt.verify(token, OPTIONS.secret, { algorithms: ['HS256'] }) as JwtPayload;
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
