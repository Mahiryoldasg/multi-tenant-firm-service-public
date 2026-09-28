import { useCurrentUser } from '../auth/SessionGate.tsx';
import { DisplayTokenPanel } from './DisplayTokenPanel.tsx';
import { EmployeesSection } from './EmployeesSection.tsx';
import { ModePanel } from './ModePanel.tsx';

const MEMBER_NOTE_TEXT = 'Üye olarak çalışanları ve aktif modu yalnızca görüntüleyebilirsiniz.';

/** The firm users' page: a firm admin manages the firm, a member only reads it. */
export function WorkspacePage() {
  const { role } = useCurrentUser();
  const canManage = role === 'firm_admin';

  return (
    <>
      <h1>Firma çalışma alanı</h1>
      {!canManage && <p className="notice">{MEMBER_NOTE_TEXT}</p>}
      {/* Keyed by role: a role change starts the section fresh, so no edit mode or row message
          from the old role comes back with a later promotion. */}
      <EmployeesSection key={role} canManage={canManage} />
      <ModePanel canManage={canManage} />
      {canManage && <DisplayTokenPanel />}
    </>
  );
}
