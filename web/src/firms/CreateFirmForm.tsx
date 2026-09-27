import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../api.ts';
import { useSession } from '../auth/session.tsx';

interface CreateFirmResponse {
  firm: { id: string; name: string };
  admin: { id: string; email: string };
}

/** Creates a firm together with its first firm admin. */
export function CreateFirmForm() {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  const create = useMutation({
    mutationFn: () =>
      request<CreateFirmResponse>('/api/firms', {
        method: 'POST',
        body: { name, adminEmail, adminPassword },
      }),
    onSuccess: () => {
      setName('');
      setAdminEmail('');
      setAdminPassword('');
      // Returned, so the button stays pending until the list shows the new row.
      return queryClient.invalidateQueries({ queryKey: ['firms'] });
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
      aria-describedby={create.isError ? 'create-firm-error' : undefined}
    >
      <h2>Yeni firma</h2>
      <label htmlFor="create-firm-name">Firma adı</label>
      <input
        id="create-firm-name"
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <label htmlFor="create-firm-email">Admin e-postası</label>
      <input
        id="create-firm-email"
        type="email"
        autoComplete="off"
        required
        value={adminEmail}
        onChange={(event) => setAdminEmail(event.target.value)}
      />
      <label htmlFor="create-firm-password">Admin şifresi</label>
      <input
        id="create-firm-password"
        type="password"
        autoComplete="new-password"
        required
        value={adminPassword}
        onChange={(event) => setAdminPassword(event.target.value)}
      />
      {create.isError && (
        <p id="create-firm-error" className="error" role="alert">
          {errorMessage(create.error)}
        </p>
      )}
      {create.isSuccess && (
        <p className="success" role="status">
          {create.data.firm.name} oluşturuldu. Yönetici e-postası: {create.data.admin.email}
        </p>
      )}
      <button type="submit" disabled={create.isPending}>
        {create.isPending ? 'Oluşturuluyor...' : 'Firma oluştur'}
      </button>
    </form>
  );
}
