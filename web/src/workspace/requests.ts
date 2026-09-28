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
