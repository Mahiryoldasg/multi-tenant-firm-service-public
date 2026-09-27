import type Database from 'better-sqlite3';
import { Router } from 'express';
import { z } from 'zod';
import { EMAIL_TAKEN, EMAIL_TAKEN_MESSAGE, isValidEmail } from '../../auth/email.ts';
import { hashPassword } from '../../auth/password.ts';
import { notFoundHandler } from '../../http/error-handler.ts';
import { HttpError } from '../../http/errors.ts';
import { INVALID_BODY_MESSAGE, parseBody, requiredString } from '../../http/validate.ts';
import type { Realtime } from '../../realtime/realtime.ts';
import {
  createFirmWithAdmin,
  findActiveFirmById,
  listActiveFirms,
  renameFirm,
  softDeleteFirm,
} from './firms.ts';

const NAME_REQUIRED_MESSAGE = 'Firma adı zorunludur.';
const ADMIN_EMAIL_REQUIRED_MESSAGE = 'Admin e-postası zorunludur.';
const ADMIN_EMAIL_INVALID_MESSAGE = 'Admin e-postası geçerli değil.';
const ADMIN_PASSWORD_REQUIRED_MESSAGE = 'Admin şifresi zorunludur.';
const FIRM_NOT_FOUND_MESSAGE = 'Firma bulunamadı.';

export const createFirmBodySchema = z.object(
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

export const renameFirmBodySchema = z.object(
  { name: requiredString(NAME_REQUIRED_MESSAGE) },
  { error: INVALID_BODY_MESSAGE },
);

export interface FirmRouterDeps {
  db: Database.Database;
  realtime: Pick<Realtime, 'disconnectFirm'>;
}

/** The platform-admin firm routes, mounted on `/api/firms` behind `requirePlatformAdmin`. */
export function createFirmRouter({ db, realtime }: FirmRouterDeps): Router {
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

  router.patch('/:id', (req, res) => {
    // The lookup comes before validation, so an unknown firm is 404 even with an invalid body.
    if (!findActiveFirmById(db, req.params.id)) {
      throw new HttpError('NOT_FOUND', FIRM_NOT_FOUND_MESSAGE);
    }
    const { name } = parseBody(renameFirmBodySchema, req.body);

    const firm = renameFirm(db, new Date().toISOString(), req.params.id, name.trim());
    if (!firm) throw new HttpError('NOT_FOUND', FIRM_NOT_FOUND_MESSAGE);

    res.json({ firm });
  });

  router.delete('/:id', (req, res) => {
    // An unknown or already deleted firm is 404: deleting is not idempotent (contract §3).
    if (!softDeleteFirm(db, new Date().toISOString(), req.params.id)) {
      throw new HttpError('NOT_FOUND', FIRM_NOT_FOUND_MESSAGE);
    }
    // After the commit, so a display that connects again fails the handshake's live-firm check.
    realtime.disconnectFirm(req.params.id);
    res.status(204).end();
  });

  // A nested router answers an unhandled OPTIONS itself (200 with an Allow header) when no error is
  // pending; failing here first keeps every unhandled request on the 404 envelope (no 405).
  router.use(notFoundHandler);

  return router;
}
