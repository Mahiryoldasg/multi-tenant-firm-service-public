import type Database from 'better-sqlite3';
import type { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppConfig } from '../config.ts';
import { HttpError } from '../http/errors.ts';
import { findActiveUserByEmail } from '../modules/platform/users.ts';
import { normalizeEmail } from './email.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { signUserToken } from './tokens.ts';
import { toUserResponse, type UserResponse } from './user-response.ts';

const INVALID_BODY_MESSAGE = 'İstek gövdesi bir JSON nesnesi olmalı.';
const EMAIL_REQUIRED_MESSAGE = 'E-posta zorunludur.';
const PASSWORD_REQUIRED_MESSAGE = 'Şifre zorunludur.';
// One message for every cause, so a failed login never reveals whether the email exists.
const LOGIN_FAILED_MESSAGE = 'E-posta veya şifre hatalı.';

const isNotBlank = (value: string) => value.trim() !== '';

// Required strings must be non-blank after trimming; unknown fields are dropped. No email format
// check: a malformed email matches no one and gets the ordinary 401. The password stays untrimmed.
const loginBodySchema = z.object(
  {
    email: z.string({ error: EMAIL_REQUIRED_MESSAGE }).refine(isNotBlank, EMAIL_REQUIRED_MESSAGE),
    password: z
      .string({ error: PASSWORD_REQUIRED_MESSAGE })
      .refine(isNotBlank, PASSWORD_REQUIRED_MESSAGE),
  },
  { error: INVALID_BODY_MESSAGE },
);

interface LoginResponse {
  token: string;
  user: UserResponse;
}

export interface LoginDeps {
  db: Database.Database;
  config: Pick<AppConfig, 'jwtSecret' | 'userTokenTtlSeconds'>;
}

/** `POST /api/auth/login` (public): exchanges email and password for a user token. */
export function createLoginHandler({ db, config }: LoginDeps): RequestHandler {
  // Checked when no user matches, so every attempt costs exactly one scrypt and the response time
  // does not reveal which emails exist.
  const dummyHash = hashPassword(randomUUID());

  return async (req, res) => {
    const parsed = loginBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message ?? INVALID_BODY_MESSAGE,
      );
    }
    const { email, password } = parsed.data;

    const user = findActiveUserByEmail(db, normalizeEmail(email));
    const passwordMatches = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
    if (!user || !passwordMatches) throw new HttpError('UNAUTHORIZED', LOGIN_FAILED_MESSAGE);

    const body: LoginResponse = {
      token: signUserToken(user, {
        secret: config.jwtSecret,
        ttlSeconds: config.userTokenTtlSeconds,
      }),
      user: toUserResponse(user),
    };
    res.json(body);
  };
}
