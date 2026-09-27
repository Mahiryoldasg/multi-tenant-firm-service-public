import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ApiError, errorMessage } from '../api.ts';
import { useSession } from '../auth/session.tsx';
import type { Firm } from './FirmsPage.tsx';

const createdAtFormat = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const RENAME_KEY = ['firms', 'rename'];

interface FirmRowProps {
  firm: Firm;
  editing: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
  /** Shows a message above the table, where it outlives this row; `null` clears it. */
  onAlert: (message: string | null) => void;
}

function isNotFound(error: Error): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** One firm in the table, with inline rename and a confirmed delete. */
export function FirmRow({ firm, editing, onStartEdit, onEndEdit, onAlert }: FirmRowProps) {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(firm.name);
  const input = useRef<HTMLInputElement>(null);
  const firmPath = `/api/firms/${encodeURIComponent(firm.id)}`;
  // While any row's rename is pending, no row may take over edit mode, so its result can show.
  const renamePending = useIsMutating({ mutationKey: RENAME_KEY }) > 0;

  function refreshFirms() {
    return queryClient.invalidateQueries({ queryKey: ['firms'] });
  }

  const rename = useMutation({
    mutationKey: RENAME_KEY,
    mutationFn: () => request(firmPath, { method: 'PATCH', body: { name: draft } }),
    onSuccess: async () => {
      // Leaves edit mode only once the list shows the new name.
      await refreshFirms();
      onEndEdit();
    },
    onError: (error) => {
      if (isNotFound(error)) {
        // Deleted elsewhere: the refetch removes this row, so the message goes above the table.
        onAlert(`${firm.name} yeniden adlandırılamadı: ${errorMessage(error)}`);
        onEndEdit();
        void refreshFirms();
      } else {
        input.current?.focus();
      }
    },
  });

  const remove = useMutation({
    mutationFn: () => request(firmPath, { method: 'DELETE' }),
    onSuccess: () => refreshFirms(),
    onError: (error) => {
      onAlert(`${firm.name} silinemedi: ${errorMessage(error)}`);
      if (isNotFound(error)) void refreshFirms();
    },
  });

  function startEdit() {
    setDraft(firm.name);
    rename.reset();
    onStartEdit();
  }

  function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onAlert(null);
    rename.mutate();
  }

  function handleRenameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Like the disabled "Vazgeç": a pending rename keeps edit mode until its result is in.
    if (event.key === 'Escape' && !rename.isPending) onEndEdit();
  }

  function handleDelete() {
    const confirmed = window.confirm(
      `${firm.name} firması silinsin mi? Firmanın tüm kullanıcıları da silinir ve bağlı ekranların bağlantısı kesilir.`,
    );
    if (!confirmed) return;
    onAlert(null);
    remove.mutate();
  }

  const inputId = `rename-${firm.id}`;
  const errorId = `rename-error-${firm.id}`;
  const createdAt = (
    <time dateTime={firm.createdAt}>{createdAtFormat.format(new Date(firm.createdAt))}</time>
  );

  if (editing) {
    return (
      <tr>
        <td>
          <form className="row-form" noValidate onSubmit={handleRenameSubmit}>
            <label htmlFor={inputId}>Yeni ad</label>
            <input
              id={inputId}
              ref={input}
              autoFocus
              required
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleRenameKeyDown}
              aria-invalid={rename.isError}
              aria-describedby={rename.isError ? errorId : undefined}
            />
            <button
              type="submit"
              disabled={rename.isPending}
              aria-label={`${firm.name} firmasının yeni adını kaydet`}
            >
              Kaydet
            </button>
            <button
              type="button"
              onClick={onEndEdit}
              disabled={rename.isPending}
              aria-label={`${firm.name} firmasını yeniden adlandırmaktan vazgeç`}
            >
              Vazgeç
            </button>
            {rename.isError && (
              <p id={errorId} className="error" role="alert">
                {errorMessage(rename.error)}
              </p>
            )}
          </form>
        </td>
        <td>{createdAt}</td>
        <td />
      </tr>
    );
  }

  return (
    <tr>
      <td>{firm.name}</td>
      <td>{createdAt}</td>
      <td>
        <div className="actions">
          <button
            type="button"
            onClick={startEdit}
            disabled={remove.isPending || renamePending}
            aria-label={`${firm.name} firmasını yeniden adlandır`}
          >
            Yeniden adlandır
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={remove.isPending}
            aria-label={`${firm.name} firmasını sil`}
          >
            Sil
          </button>
        </div>
      </td>
    </tr>
  );
}
