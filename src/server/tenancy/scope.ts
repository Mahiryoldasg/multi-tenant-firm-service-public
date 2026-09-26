import type Database from 'better-sqlite3';
import { createEmployeesRepository, type EmployeesRepository } from './employees.ts';

/**
 * The only data access tenant handlers get (`req.tenant`): repositories bound to one firm. The
 * `firm_id = @firmId` filter is written only in these repositories, and none of their methods takes
 * a firm id, so a handler cannot ask for another firm's rows.
 */
export interface TenantScope {
  employees: EmployeesRepository;
}

/** Builds the scope of `firmId`. It runs no query: each method prepares its statement when called. */
export function createTenantScope(db: Database.Database, firmId: string): TenantScope {
  return {
    employees: createEmployeesRepository(db, firmId),
  };
}
