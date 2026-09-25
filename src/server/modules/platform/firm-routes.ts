import type Database from 'better-sqlite3';
import { Router } from 'express';
import { z } from 'zod';
import { isValidEmail } from '../../auth/email.ts';
import { hashPassword } from '../../auth/password.ts';
import { HttpError } from '../../http/errors.ts';
import { INVALID_BODY_MESSAGE, parseBody, requiredString } from '../../http/validate.ts';
import { createFirmWithAdmin, EMAIL_TAKEN, listActiveFirms } from './firms.ts';

const NAME_REQUIRED_MESSAGE = 'Firma adı zorunludur.';
const ADMIN_EMAIL_REQUIRED_MESSAGE = 'Admin e-postası zorunludur.';
const ADMIN_EMAIL_INVALID_MESSAGE = 'Admin e-postası geçerli değil.';
const ADMIN_PASSWORD_REQUIRED_MESSAGE = 'Admin şifresi zorunludur.';
const EMAIL_TAKEN_MESSAGE = 'Bu e-posta adresi zaten kullanılıyor.';

const createFirmBodySchema = z.object(
  {
    name: requiredString(NAME_REQUIRED_MESSAGE),
    adminEmail: requiredString(ADMIN_EMAIL_REQUIRED_MESSAGE).refine(
      isValidEmail,
      ADMIN_EMAIL_INVALID_MESSAGE,
    ),
    adminPassword: requiredString(ADMIN_PASSWORD_REQUIRED_MESSAGE),
  },
  { error: INVALID_BODY_MESSAGE },
);

export interface FirmRouterDeps {
  db: Database.Database;
}

/** The platform-admin firm routes, mounted on `/api/firms` behind `requirePlatformAdmin`. */
export function createFirmRouter({ db }: FirmRouterDeps): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ firms: listActiveFirms(db) });
  });

  router.post('/', async (req, res) => {
    const { name, adminEmail, adminPassword } = parseBody(createFirmBodySchema, req.body);

    // Hashed before the transaction, which must be synchronous. The password is hashed untrimmed.
    const adminPasswordHash = await hashPassword(adminPassword);
    const created = createFirmWithAdmin(db, new Date().toISOString(), {
      name: name.trim(),
      adminEmail: adminEmail.trim(),
      adminPasswordHash,
    });
    if (created === EMAIL_TAKEN) throw new HttpError('CONFLICT', EMAIL_TAKEN_MESSAGE);

    res.status(201).json(created);
  });

  return router;
}
