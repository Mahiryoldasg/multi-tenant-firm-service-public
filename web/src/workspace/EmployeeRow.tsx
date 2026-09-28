import { ROLE_LABELS, useCurrentUser } from '../auth/SessionGate.tsx';
import type { Employee } from './requests.ts';

interface EmployeeRowProps {
  employee: Employee;
}

/** One employee in the table. */
export function EmployeeRow({ employee }: EmployeeRowProps) {
  const currentUser = useCurrentUser();
  const isSelf = employee.id === currentUser.id;

  return (
    <tr>
      <td>
        {employee.email}
        {isSelf && ' (siz)'}
      </td>
      <td>{ROLE_LABELS[employee.role]}</td>
    </tr>
  );
}
