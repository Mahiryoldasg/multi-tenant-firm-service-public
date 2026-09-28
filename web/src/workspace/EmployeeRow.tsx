import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ApiError, errorMessage } from '../api.ts';
import { ROLE_LABELS, useCurrentUser } from '../auth/SessionGate.tsx';
import { useSession } from '../auth/session.tsx';
import {
  employeeChanges,
  type Employee,
  type EmployeeChanges,
  type EmployeeRole,
} from './requests.ts';

const UPDATE_KEY = ['employees', 'update'];

const SELF_DELETE_CONFIRM_TEXT =
  'Kendi hesabınızı siliyorsunuz. Oturumunuz kapanacak ve bu hesapla bir daha giriş yapamayacaksınız. Devam edilsin mi?';

interface EmployeeRowProps {
  employee: Employee;
  /** A firm admin gets the row actions; a member only reads the row. */
  canManage: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
  /** Shows a message above the table, where it outlives this row; `null` clears it. */
  onAlert: (message: string | null) => void;
}

function isNotFound(error: Error): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** One employee in the table, with an inline edit and a confirmed delete for a firm admin. */
export function EmployeeRow({
  employee,
  canManage,
  editing,
  onStartEdit,
  onEndEdit,
  onAlert,
}: EmployeeRowProps) {
  const { request, signOut } = useSession();
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();
  // The row as it was when the edit began. A list refetch during the edit can bring newer values,
  // and a save must send only what the user changed, not undo someone else's change (F-01).
  const [editBase, setEditBase] = useState(employee);
  const [draftEmail, setDraftEmail] = useState(employee.email);
  const [draftRole, setDraftRole] = useState<EmployeeRole>(employee.role);
  const emailInput = useRef<HTMLInputElement>(null);
  const isSelf = employee.id === currentUser.id;
  const employeePath = `/api/employees/${encodeURIComponent(employee.id)}`;
  // While any row's update is pending, no row may take over edit mode, so its result can show.
  const updatePending = useIsMutating({ mutationKey: UPDATE_KEY }) > 0;

  function refreshEmployees() {
    return queryClient.invalidateQueries({ queryKey: ['employees'] });
  }

  const update = useMutation({
    mutationKey: UPDATE_KEY,
    mutationFn: (changes: EmployeeChanges) =>
      request(employeePath, { method: 'PATCH', body: changes }),
    onSuccess: async () => {
      const refreshes = [refreshEmployees()];
      // Your own row also reloads `/me`, so the header and the role view follow the change.
      if (isSelf) refreshes.push(queryClient.invalidateQueries({ queryKey: ['me'] }));
      // Leaves edit mode only once the list shows the change.
      await Promise.all(refreshes);
      onEndEdit();
    },
    onError: (error) => {
      if (isNotFound(error)) {
        // Deleted elsewhere: the refetch removes this row, so the message goes above the table.
        onAlert(`${employee.email} güncellenemedi: ${errorMessage(error)}`);
        onEndEdit();
        void refreshEmployees();
      } else {
        emailInput.current?.focus();
      }
    },
  });

  const remove = useMutation({
    mutationFn: () => request(employeePath, { method: 'DELETE' }),
    onSuccess: () => {
      // Your own account and its token are gone: sign out, without the expiry notice.
      if (isSelf) {
        signOut();
        return;
      }
      return refreshEmployees();
    },
    onError: (error) => {
      onAlert(`${employee.email} silinemedi: ${errorMessage(error)}`);
      if (isNotFound(error)) void refreshEmployees();
    },
  });

  function startEdit() {
    setEditBase(employee);
    setDraftEmail(employee.email);
    setDraftRole(employee.role);
    update.reset();
    onStartEdit();
  }

  function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onAlert(null);
    const changes = employeeChanges(editBase, { email: draftEmail, role: draftRole });
    // Nothing to save, so nothing to send.
    if (changes === null) {
      onEndEdit();
      return;
    }
    update.mutate(changes);
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    // Like the disabled "Vazgeç": a pending update keeps edit mode until its result is in.
    if (event.key === 'Escape' && !update.isPending) onEndEdit();
  }

  function handleDelete() {
    const confirmed = window.confirm(
      isSelf
        ? SELF_DELETE_CONFIRM_TEXT
        : `${employee.email} çalışanı silinsin mi? Bu kullanıcı bir daha giriş yapamaz.`,
    );
    if (!confirmed) return;
    onAlert(null);
    remove.mutate();
  }

  const emailId = `employee-email-${employee.id}`;
  const roleId = `employee-role-${employee.id}`;
  const errorId = `employee-error-${employee.id}`;

  // A member never edits, even when a self-demotion lands while the row is in edit mode.
  if (canManage && editing) {
    return (
      <tr>
        <td colSpan={3}>
          <form
            className="row-form"
            noValidate
            onSubmit={handleEditSubmit}
            onKeyDown={handleEditKeyDown}
          >
            <label htmlFor={emailId}>E-posta</label>
            <input
              id={emailId}
              ref={emailInput}
              type="email"
              autoComplete="off"
              autoFocus
              required
              value={draftEmail}
              onChange={(event) => setDraftEmail(event.target.value)}
              aria-invalid={update.isError}
              aria-describedby={update.isError ? errorId : undefined}
            />
            <label htmlFor={roleId}>Rol</label>
            <select
              id={roleId}
              value={draftRole}
              onChange={(event) => setDraftRole(event.target.value as EmployeeRole)}
            >
              <option value="member">{ROLE_LABELS.member}</option>
              <option value="firm_admin">{ROLE_LABELS.firm_admin}</option>
            </select>
            <button
              type="submit"
              disabled={update.isPending}
              aria-label={`${employee.email} çalışanının değişikliklerini kaydet`}
            >
              Kaydet
            </button>
            <button
              type="button"
              onClick={onEndEdit}
              disabled={update.isPending}
              aria-label={`${employee.email} çalışanını düzenlemekten vazgeç`}
            >
              Vazgeç
            </button>
            {update.isError && (
              <p id={errorId} className="error" role="alert">
                {errorMessage(update.error)}
              </p>
            )}
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        {employee.email}
        {isSelf && ' (siz)'}
      </td>
      <td>{ROLE_LABELS[employee.role]}</td>
      {canManage && (
        <td>
          <div className="actions">
            <button
              type="button"
              onClick={startEdit}
              disabled={remove.isPending || updatePending}
              aria-label={`${employee.email} çalışanını düzenle`}
            >
              Düzenle
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={remove.isPending}
              aria-label={`${employee.email} çalışanını sil`}
            >
              Sil
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}
