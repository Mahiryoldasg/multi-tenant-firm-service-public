import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../api.ts';
import { useSession } from '../auth/session.tsx';

/** The `GET` and `POST /api/mode` answer; `null` until the firm's first mode is set. */
interface ModeResponse {
  modeId: string | null;
}

interface ModePanelProps {
  /** A firm admin sets the mode; a member only reads it. */
  canManage: boolean;
}

/** The firm's active mode, with a form to set it for a firm admin. */
export function ModePanel({ canManage }: ModePanelProps) {
  const { request } = useSession();
  const mode = useQuery({
    queryKey: ['mode'],
    queryFn: async () => (await request<ModeResponse>('/api/mode')).modeId,
  });

  return (
    <section>
      <h2>Aktif mod</h2>
      {/* A failed refetch keeps the last value below the error. */}
      {mode.isError && (
        <>
          <p className="error" role="alert">
            {errorMessage(mode.error)}
          </p>
          <button type="button" onClick={() => void mode.refetch()}>
            Tekrar dene
          </button>
        </>
      )}
      {mode.isPending && <p role="status">Mod yükleniyor...</p>}
      {mode.data === null && <p>Henüz bir mod seçilmedi.</p>}
      {typeof mode.data === 'string' && (
        <p>
          Aktif mod: <code>{mode.data}</code>
        </p>
      )}
      {canManage && <SetModeForm />}
    </section>
  );
}

/** Sets the firm's active mode, which the API also sends to the firm's connected displays. */
function SetModeForm() {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const [modeId, setModeId] = useState('');

  const setMode = useMutation({
    mutationFn: () => request<ModeResponse>('/api/mode', { method: 'POST', body: { modeId } }),
    onSuccess: (data) => {
      // The answer is the new value, so the panel shows it without a refetch.
      queryClient.setQueryData(['mode'], data.modeId);
      setModeId('');
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Sent as typed: the API stores the mode untrimmed, and the same value again is still sent to
    // the displays. A new submit drops the previous error and status message.
    setMode.mutate();
  }

  return (
    <form
      className="form"
      noValidate
      onSubmit={handleSubmit}
      aria-describedby={setMode.isError ? 'set-mode-error' : undefined}
    >
      <label htmlFor="set-mode-id">Yeni mod kimliği</label>
      <input
        id="set-mode-id"
        autoComplete="off"
        required
        value={modeId}
        onChange={(event) => setModeId(event.target.value)}
      />
      {setMode.isError && (
        <p id="set-mode-error" className="error" role="alert">
          {errorMessage(setMode.error)}
        </p>
      )}
      {setMode.isSuccess && (
        <p className="success" role="status">
          Mod uygulandı ve bu firmanın bağlı ekranlarına gönderildi.
        </p>
      )}
      <button type="submit" disabled={setMode.isPending}>
        {setMode.isPending ? 'Uygulanıyor...' : 'Modu uygula'}
      </button>
    </form>
  );
}
