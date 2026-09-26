import { Router } from 'express';
import { z } from 'zod';
import { EMAIL_TAKEN, EMAIL_TAKEN_MESSAGE, isValidEmail } from '../../auth/email.ts';
import { hashPassword } from '../../auth/password.ts';
import { INVALID_SESSION_MESSAGE } from '../../http/authenticate.ts';
import { requireFirmAdmin } from '../../http/authorize.ts';
import { notFoundHandler } from '../../http/error-handler.ts';
import { HttpError } from '../../http/errors.ts';
import { getTenant } from '../../http/tenant.ts';
import { INVALID_BODY_MESSAGE, parseBody, requiredString } from '../../http/validate.ts';
import { FIRM_GONE } from '../../tenancy/employees.ts';

// One message for an unknown, deleted and other-firm id, so a 404 never tells them apart.
const EMPLOYEE_NOT_FOUND_MESSAGE = 'Çalışan bulunamadı.';
const EMAIL_REQUIRED_MESSAGE = 'E-posta zorunludur.';
const EMAIL_INVALID_MESSAGE = 'E-posta geçerli değil.';
const PASSWORD_REQUIRED_MESSAGE = 'Şifre zorunludur.';
const ROLE_INVALID_MESSAGE = 'Rol firm_admin veya member olmalı.';
const EMPTY_UPDATE_MESSAGE = 'Güncellenecek bir alan gönderilmeli (email veya role).';

const emailSchema = requiredString(EMAIL_REQUIRED_MESSAGE).refine(
  isValidEmail,
  EMAIL_INVALID_MESSAGE,
);

// Exact values only: a platform admin cannot be made here, and the role is never trimmed.
const employeeRoleSchema = z.enum(['firm_admin', 'member'], { error: ROLE_INVALID_MESSAGE });

const createEmployeeBodySchema = z.object(
  {
    email: emailSchema,
    password: requiredString(PASSWORD_REQUIRED_MESSAGE),
    role: employeeRoleSchema,
  },
  { error: INVALID_BODY_MESSAGE },
);

// Unknown fields, `password` and `firmId` included, are dropped: neither can change here.
const updateEmployeeBodySchema = z
  .object(
    { email: emailSchema.optional(), role: employeeRoleSchema.optional() },
    { error: INVALID_BODY_MESSAGE },
  )
  .refine((body) => body.email !== undefined || body.role !== undefined, EMPTY_UPDATE_MESSAGE);

// The methods that change employees. Other methods have no route here and stay 404 for everyone.
const WRITE_METHODS = new Set(['POST', 'PATCH', 'DELETE']);

/**
 * The employee routes of the caller's firm, mounted on `/api/employees` behind `requireTenant`. They
 * read and write only through `getTenant(req)`, so every query is bound to the caller's firm.
 */
export function createEmployeeRouter(): Router {
  const router = Router();

  // The role check runs before any route matches: Express decodes `:id` while matching, so a
  // per-route guard would let a member's write to an undecodable id reach 404 before 403.
  router.use((req, res, next) => {
    if (WRITE_METHODS.has(req.method)) {
      requireFirmAdmin(req, res, next);
      return;
    }
    next();
  });

  router.get('/', (req, res) => {
    res.json({ employees: getTenant(req).employees.list() });
  });

  router.get('/:id', (req, res) => {
    const employee = getTenant(req).employees.findById(req.params.id);
    if (!employee) throw new HttpError('NOT_FOUND', EMPLOYEE_NOT_FOUND_MESSAGE);
    res.json({ employee });
  });

  router.post('/', async (req, res) => {
    const { email, password, role } = parseBody(createEmployeeBodySchema, req.body);

    // Hashed before the repository's transaction, which must be synchronous. The password is hashed
    // untrimmed.
    const passwordHash = await hashPassword(password);
    const created = getTenant(req).employees.create(new Date().toISOString(), {
      email: email.trim(),
      role,
      passwordHash,
    });
    // The caller's firm was deleted while the password was hashed: their session is gone with it.
    if (created === FIRM_GONE) throw new HttpError('UNAUTHORIZED', INVALID_SESSION_MESSAGE);
    if (created === EMAIL_TAKEN) throw new HttpError('CONFLICT', EMAIL_TAKEN_MESSAGE);

    res.status(201).json({ employee: created });
  });

  router.patch('/:id', (req, res) => {
    const { employees } = getTenant(req);
    // The lookup comes before validation, so another firm's or a deleted employee is 404 even with
    // an invalid body (contract §3).
    if (!employees.findById(req.params.id)) {
      throw new HttpError('NOT_FOUND', EMPLOYEE_NOT_FOUND_MESSAGE);
    }
    const { email, role } = parseBody(updateEmployeeBodySchema, req.body);

    const employee = employees.update(new Date().toISOString(), req.params.id, {
      email: email?.trim(),
      role,
    });
    if (employee === EMAIL_TAKEN) throw new HttpError('CONFLICT', EMAIL_TAKEN_MESSAGE);
    if (!employee) throw new HttpError('NOT_FOUND', EMPLOYEE_NOT_FOUND_MESSAGE);

    res.json({ employee });
  });

  // Like the firm router: keeps every unhandled request, OPTIONS included, on the 404 envelope.
  router.use(notFoundHandler);

  return router;
}
