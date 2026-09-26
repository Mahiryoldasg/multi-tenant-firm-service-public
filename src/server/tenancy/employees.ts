import type Database from 'better-sqlite3';
import type { Role } from '../auth/tokens.ts';

/** A user of the scope's firm, with exactly the fields the contract returns for an employee. */
export interface Employee {
  id: string;
  email: string;
  // An employee always has a firm, and the users CHECK keeps the platform admin firmless.
  role: Exclude<Role, 'platform_admin'>;
}

/** The employee reads of one firm. No method takes a firm id: the firm is fixed at construction. */
export interface EmployeesRepository {
  /** The firm's active employees, oldest first. */
  list(): Employee[];
  /** An active employee of this firm; unknown, deleted and other-firm ids are all `undefined`. */
  findById(id: string): Employee | undefined;
}

/** Binds the employee reads to `firmId`; every statement filters on it. */
export function createEmployeesRepository(
  db: Database.Database,
  firmId: string,
): EmployeesRepository {
  return {
    list() {
      // rowid keeps the insertion order of employees created in the same instant (the seed).
      return db
        .prepare<{ firmId: string }, Employee>(
          `SELECT id, email, role
             FROM users
            WHERE firm_id = @firmId
              AND deleted_at IS NULL
            ORDER BY created_at, rowid`,
        )
        .all({ firmId });
    },

    findById(id) {
      return db
        .prepare<{ firmId: string; id: string }, Employee>(
          `SELECT id, email, role
             FROM users
            WHERE id = @id
              AND firm_id = @firmId
              AND deleted_at IS NULL`,
        )
        .get({ firmId, id });
    },
  };
}
