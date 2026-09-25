import jwt from 'jsonwebtoken';

export type Role = 'platform_admin' | 'firm_admin' | 'member';

/** User token claims (contract §2). `jsonwebtoken` adds `iat` and `exp`. */
export interface UserTokenClaims {
  sub: string;
  role: Role;
  firmId?: string;
}

export interface UserTokenOptions {
  secret: string;
  ttlSeconds: number;
}

/** Signs an HS256 user token. `firmId` is omitted, not `null`, for the platform admin. */
export function signUserToken(
  user: { id: string; role: Role; firmId: string | null },
  { secret, ttlSeconds }: UserTokenOptions,
): string {
  const claims: UserTokenClaims = { sub: user.id, role: user.role };
  if (user.firmId !== null) claims.firmId = user.firmId;
  return jwt.sign(claims, secret, { algorithm: 'HS256', expiresIn: ttlSeconds });
}
