// UI-side types and request bodies for the firm workspace. DOM-free and without JSX, so the Node
// test suite can import it.

/** The roles an employee can have; the platform admin is never an employee. */
export type EmployeeRole = 'firm_admin' | 'member';

/** An employee in the `/api/employees` responses. */
export interface Employee {
  id: string;
  email: string;
  role: EmployeeRole;
}

/** The `PATCH /api/employees/:id` body: an absent field keeps its value. */
export interface EmployeeChanges {
  email?: string;
  role?: EmployeeRole;
}

/**
 * Only the fields the edit changed, so a save never overwrites what someone else changed in the
 * other field meanwhile; `null` when nothing changed.
 */
export function employeeChanges(
  employee: Employee,
  draft: { email: string; role: EmployeeRole },
): EmployeeChanges | null {
  const changes: EmployeeChanges = {};
  // An exact comparison: a casing-only change is a change. The email is sent as typed; the API trims it.
  if (draft.email !== employee.email) changes.email = draft.email;
  if (draft.role !== employee.role) changes.role = draft.role;
  return changes.email === undefined && changes.role === undefined ? null : changes;
}
