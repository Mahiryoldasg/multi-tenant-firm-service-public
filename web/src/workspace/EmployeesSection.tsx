import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../api.ts';
import { useSession } from '../auth/session.tsx';
import { CreateEmployeeForm } from './CreateEmployeeForm.tsx';
import { EmployeeRow } from './EmployeeRow.tsx';
import type { Employee } from './requests.ts';

interface EmployeesSectionProps {
  /** A firm admin manages employees; a member only reads the list. */
  canManage: boolean;
}

/** The employees of the signed-in user's firm. */
export function EmployeesSection({ canManage }: EmployeesSectionProps) {
  const { request } = useSession();
  const employees = useQuery({
    queryKey: ['employees'],
    queryFn: async () => (await request<{ employees: Employee[] }>('/api/employees')).employees,
  });
  // Only one row edits at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  // A failed row action; kept here because a 404 removes the row itself.
  const [rowAlert, setRowAlert] = useState<string | null>(null);

  return (
    <section>
      <h2 id="employee-list-heading">Çalışanlar</h2>
      {canManage && <CreateEmployeeForm />}
      {/* A failed refetch keeps the last list below the error. */}
      {employees.isError && (
        <>
          <p className="error" role="alert">
            {errorMessage(employees.error)}
          </p>
          <button type="button" onClick={() => void employees.refetch()}>
            Tekrar dene
          </button>
        </>
      )}
      {rowAlert && (
        <p className="error" role="alert">
          {rowAlert}
        </p>
      )}
      {employees.isPending && <p role="status">Çalışanlar yükleniyor...</p>}
      {employees.data?.length === 0 && <p>Henüz çalışan yok.</p>}
      {employees.data && employees.data.length > 0 && (
        <table aria-labelledby="employee-list-heading">
          <thead>
            <tr>
              <th scope="col">E-posta</th>
              <th scope="col">Rol</th>
              {canManage && <th scope="col">İşlemler</th>}
            </tr>
          </thead>
          <tbody>
            {/* The API already sends the oldest employee first. */}
            {employees.data.map((employee) => (
              <EmployeeRow
                key={employee.id}
                employee={employee}
                canManage={canManage}
                editing={editingId === employee.id}
                onStartEdit={() => setEditingId(employee.id)}
                // Ends only this row's edit, in case another row started editing meanwhile.
                onEndEdit={() => setEditingId((id) => (id === employee.id ? null : id))}
                onAlert={setRowAlert}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
