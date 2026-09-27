import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { FORBIDDEN_TEXT } from '../api.ts';
import { useCurrentUser } from './SessionGate.tsx';
import type { Role } from './session.tsx';

/**
 * Shows its page only to the given roles and the forbidden text to anyone else. This is for
 * clarity only: the API's own guards decide what each user may read or change.
 */
export function RequireRole({ roles, children }: { roles: readonly Role[]; children: ReactNode }) {
  const { role } = useCurrentUser();
  if (roles.includes(role)) return children;

  return (
    <>
      <p className="error" role="alert">
        {FORBIDDEN_TEXT}
      </p>
      <Link to="/">Ana sayfaya dön</Link>
    </>
  );
}
