import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../api.ts';
import { useSession } from '../auth/session.tsx';
import { CreateFirmForm } from './CreateFirmForm.tsx';
import { FirmRow } from './FirmRow.tsx';

/** A firm in the `GET /api/firms` response. */
export interface Firm {
  id: string;
  name: string;
  createdAt: string;
}

/** The platform admin's firm screen. */
export function FirmsPage() {
  const { request } = useSession();
  const firms = useQuery({
    queryKey: ['firms'],
    queryFn: async () => (await request<{ firms: Firm[] }>('/api/firms')).firms,
  });
  // Only one row edits at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  // A failed row action; kept here because a 404 removes the row itself.
  const [rowAlert, setRowAlert] = useState<string | null>(null);

  return (
    <>
      <h1>Firmalar</h1>
      <CreateFirmForm />
      <section>
        <h2 id="firm-list-heading">Firma listesi</h2>
        {/* A failed refetch keeps the last list below the error. */}
        {firms.isError && (
          <>
            <p className="error" role="alert">
              {errorMessage(firms.error)}
            </p>
            <button type="button" onClick={() => void firms.refetch()}>
              Tekrar dene
            </button>
          </>
        )}
        {rowAlert && (
          <p className="error" role="alert">
            {rowAlert}
          </p>
        )}
        {firms.isPending && <p role="status">Firmalar yükleniyor...</p>}
        {firms.data?.length === 0 && <p>Henüz firma yok.</p>}
        {firms.data && firms.data.length > 0 && (
          <table aria-labelledby="firm-list-heading">
            <thead>
              <tr>
                <th scope="col">Firma adı</th>
                <th scope="col">Oluşturulma</th>
                <th scope="col">İşlemler</th>
              </tr>
            </thead>
            <tbody>
              {/* The API already sends the oldest firm first. */}
              {firms.data.map((firm) => (
                <FirmRow
                  key={firm.id}
                  firm={firm}
                  editing={editingId === firm.id}
                  onStartEdit={() => setEditingId(firm.id)}
                  // Ends only this row's edit, in case another row started editing meanwhile.
                  onEndEdit={() => setEditingId((id) => (id === firm.id ? null : id))}
                  onAlert={setRowAlert}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
