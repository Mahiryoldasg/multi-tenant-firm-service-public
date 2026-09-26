import { Router } from 'express';
import { requireFirmAdmin } from '../../http/authorize.ts';
import { notFoundHandler } from '../../http/error-handler.ts';
import { HttpError } from '../../http/errors.ts';
import { getTenant } from '../../http/tenant.ts';

// One message for an unknown, deleted and other-firm id, so a 404 never tells them apart.
const EMPLOYEE_NOT_FOUND_MESSAGE = 'Çalışan bulunamadı.';

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

  // Like the firm router: keeps every unhandled request, OPTIONS included, on the 404 envelope.
  router.use(notFoundHandler);

  return router;
}
