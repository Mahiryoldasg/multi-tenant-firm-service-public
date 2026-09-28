import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation, useOutletContext } from 'react-router';
import { errorMessage } from '../api.ts';
import { LoginPage } from './LoginPage.tsx';
import { useSession, type Role, type User } from './session.tsx';

export const ROLE_LABELS: Record<Role, string> = {
  platform_admin: 'Platform yöneticisi',
  firm_admin: 'Firma yöneticisi',
  member: 'Üye',
};

/**
 * Wraps every signed-in route: without a token it shows the login form at `/`, otherwise it loads
 * the current user from `/api/auth/me` (the DB role, which may have changed since login).
 */
export function SessionGate() {
  const { token, signOut, request } = useSession();
  const location = useLocation();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await request<{ user: User }>('/api/auth/me')).user,
    enabled: token !== null,
  });

  if (token === null) {
    return location.pathname === '/' ? <LoginPage /> : <Navigate to="/" replace />;
  }

  // Checked before the error, so a failed background refetch keeps the page on screen.
  if (me.data) {
    return (
      <>
        <header className="app-header">
          <span className="app-title">Firma Yönetim Paneli</span>
          <span>
            {me.data.email} · {ROLE_LABELS[me.data.role]}
          </span>
          <button type="button" onClick={signOut}>
            Çıkış yap
          </button>
        </header>
        <main>
          <Outlet context={me.data} />
        </main>
      </>
    );
  }

  if (me.isError) {
    return (
      <main>
        <p className="error" role="alert">
          {errorMessage(me.error)}
        </p>
        <div className="actions">
          <button type="button" onClick={() => void me.refetch()}>
            Tekrar dene
          </button>
          <button type="button" onClick={signOut}>
            Çıkış yap
          </button>
        </div>
      </main>
    );
  }

  return (
    <main>
      <p role="status">Oturum kontrol ediliyor...</p>
    </main>
  );
}

/** The signed-in user; only for routes rendered inside `SessionGate`. */
export function useCurrentUser(): User {
  return useOutletContext<User>();
}

/** The index route: sends each role to its own home. */
export function RoleHome() {
  const { role } = useCurrentUser();
  return <Navigate to={role === 'platform_admin' ? '/firms' : '/workspace'} replace />;
}
