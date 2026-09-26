import { Router } from 'express';
import { notFoundHandler } from '../../http/error-handler.ts';
import { HttpError } from '../../http/errors.ts';
import { getTenant } from '../../http/tenant.ts';

// One message for an unknown, deleted and other-firm id, so a 404 never tells them apart.
const EMPLOYEE_NOT_FOUND_MESSAGE = 'Çalışan bulunamadı.';

/**
 * The employee routes of the caller's firm, mounted on `/api/employees` behind `requireTenant`. They
 * read and write only through `getTenant(req)`, so every query is bound to the caller's firm.
 */
export function createEmployeeRouter(): Router {
  const router = Router();

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
