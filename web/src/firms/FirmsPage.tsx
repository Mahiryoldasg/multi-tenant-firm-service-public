import { useQuery } from '@tanstack/react-query';
import { errorMessage } from '../api.ts';
import { useSession } from '../auth/session.tsx';
import { CreateFirmForm } from './CreateFirmForm.tsx';

/** A firm in the `GET /api/firms` response. */
export interface Firm {
  id: string;
  name: string;
  createdAt: string;
}

const createdAtFormat = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** The platform admin's firm screen. */
export function FirmsPage() {
  const { request } = useSession();
  const firms = useQuery({
    queryKey: ['firms'],
    queryFn: async () => (await request<{ firms: Firm[] }>('/api/firms')).firms,
  });

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
        {firms.isPending && <p role="status">Firmalar yükleniyor...</p>}
        {firms.data?.length === 0 && <p>Henüz firma yok.</p>}
        {firms.data && firms.data.length > 0 && (
          <table aria-labelledby="firm-list-heading">
            <thead>
              <tr>
                <th scope="col">Firma adı</th>
                <th scope="col">Oluşturulma</th>
              </tr>
            </thead>
            <tbody>
              {/* The API already sends the oldest firm first. */}
              {firms.data.map((firm) => (
                <tr key={firm.id}>
                  <td>{firm.name}</td>
                  <td>
                    <time dateTime={firm.createdAt}>
                      {createdAtFormat.format(new Date(firm.createdAt))}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
