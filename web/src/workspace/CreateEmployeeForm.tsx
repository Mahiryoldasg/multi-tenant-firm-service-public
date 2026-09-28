import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../api.ts';
import { ROLE_LABELS } from '../auth/SessionGate.tsx';
import { useSession } from '../auth/session.tsx';
import type { Employee, EmployeeRole } from './requests.ts';

/** Adds an employee to the signed-in firm admin's firm. */
export function CreateEmployeeForm() {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<EmployeeRole>('member');

  const create = useMutation({
    mutationFn: () =>
      request<{ employee: Employee }>('/api/employees', {
        method: 'POST',
        body: { email, password, role },
      }),
    onSuccess: () => {
      setEmail('');
      setPassword('');
      setRole('member');
      // Returned, so the button stays pending until the list shows the new row.
      return queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A new submit drops the previous error and status message.
    create.mutate();
  }

  return (
    <form
      className="form"
      noValidate
      onSubmit={handleSubmit}
      aria-describedby={create.isError ? 'create-employee-error' : undefined}
    >
      <h3>Yeni çalışan</h3>
      <label htmlFor="create-employee-email">E-posta</label>
      <input
        id="create-employee-email"
        type="email"
        autoComplete="off"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <label htmlFor="create-employee-password">Şifre</label>
      <input
        id="create-employee-password"
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <label htmlFor="create-employee-role">Rol</label>
      <select
        id="create-employee-role"
        value={role}
        onChange={(event) => setRole(event.target.value as EmployeeRole)}
      >
        <option value="member">{ROLE_LABELS.member}</option>
        <option value="firm_admin">{ROLE_LABELS.firm_admin}</option>
      </select>
      {create.isError && (
        <p id="create-employee-error" className="error" role="alert">
          {errorMessage(create.error)}
        </p>
      )}
      {create.isSuccess && (
        <p className="success" role="status">
          {create.data.employee.email} eklendi.
        </p>
      )}
      <button type="submit" disabled={create.isPending}>
        {create.isPending ? 'Ekleniyor...' : 'Çalışan ekle'}
      </button>
    </form>
  );
}
