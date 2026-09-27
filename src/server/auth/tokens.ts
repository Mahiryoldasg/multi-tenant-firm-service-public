import jwt, { type JwtPayload } from 'jsonwebtoken';

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

/**
 * Display token claims (contract §2). `jsonwebtoken` adds `iat`, and `jti` is the id of the token's
 * `display_tokens` row. No `sub` or `role`, so it can never pass for a user token.
 */
export interface DisplayTokenClaims {
  kind: 'display';
  firmId: string;
}

/**
 * Signs an HS256 display token for the socket handshake only. It has no `exp`: it stays valid until
 * its firm is deleted, whatever happens to the user who issued it.
 */
export function signDisplayToken(
  displayToken: { id: string; firmId: string },
  secret: string,
): string {
  const claims: DisplayTokenClaims = { kind: 'display', firmId: displayToken.firmId };
  return jwt.sign(claims, secret, { algorithm: 'HS256', jwtid: displayToken.id });
}

/**
 * Returns the claims of a token signed by us, or `undefined` for any token that fails verification
 * (bad signature, other algorithm, expired, malformed, not a claims object). It does not tell a
 * user token from a display token; callers check the claims they need.
 */
export function verifyToken(token: string, secret: string): JwtPayload | undefined {
  let payload: JwtPayload | string;
  try {
    // Pinned, so a token cannot pick its own algorithm (`none`, or another HMAC with our secret).
    payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch (err) {
    // JsonWebTokenError also covers TokenExpiredError and NotBeforeError. jsonwebtoken does not wrap
    // one parse failure: with `typ: 'JWT'` in the header, jws JSON-parses the payload before any
    // signature check, so a crafted non-JSON payload throws a raw SyntaxError (F-04). With string
    // arguments nothing else in `verify` throws a SyntaxError; any other error must surface.
    if (err instanceof jwt.JsonWebTokenError || err instanceof SyntaxError) return undefined;
    throw err;
  }
  return typeof payload === 'string' ? undefined : payload;
}
