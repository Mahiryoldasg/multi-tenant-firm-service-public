import { useCurrentUser } from '../auth/SessionGate.tsx';
import { EmployeesSection } from './EmployeesSection.tsx';

const MEMBER_NOTE_TEXT = 'Üye olarak çalışanları ve aktif modu yalnızca görüntüleyebilirsiniz.';

/** The firm users' page: a firm admin manages the firm, a member only reads it. */
export function WorkspacePage() {
  const canManage = useCurrentUser().role === 'firm_admin';

  return (
    <>
      <h1>Firma çalışma alanı</h1>
      {!canManage && <p className="notice">{MEMBER_NOTE_TEXT}</p>}
      <EmployeesSection canManage={canManage} />
    </>
  );
}
