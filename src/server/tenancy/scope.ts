import type Database from 'better-sqlite3';
import { createDisplayTokensRepository, type DisplayTokensRepository } from './display-tokens.ts';
import { createDisplayChannel, type DisplayChannel, type ModeBroadcaster } from './displays.ts';
import { createEmployeesRepository, type EmployeesRepository } from './employees.ts';
import { createModeRepository, type ModeRepository } from './mode.ts';

/**
 * The only data access tenant handlers get (`req.tenant`): repositories bound to one firm, and that
 * firm's display channel. The `firm_id = @firmId` filter is written only in these repositories, and
 * no method takes a firm id, so a handler cannot ask for another firm's rows or reach another
 * firm's displays.
 */
export interface TenantScope {
  employees: EmployeesRepository;
  mode: ModeRepository;
  displayTokens: DisplayTokensRepository;
  displays: DisplayChannel;
}

/** Builds the scope of `firmId`. It runs no query: each method prepares its statement when called. */
export function createTenantScope(
  db: Database.Database,
  firmId: string,
  realtime: ModeBroadcaster,
): TenantScope {
  return {
    employees: createEmployeesRepository(db, firmId),
    mode: createModeRepository(db, firmId),
    displayTokens: createDisplayTokensRepository(db, firmId),
    displays: createDisplayChannel(realtime, firmId),
  };
}
