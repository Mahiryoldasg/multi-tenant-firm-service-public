import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { apiRequest, type ApiRequestOptions } from '../api.ts';

const TOKEN_KEY = 'firm-service.token';

export type Role = 'platform_admin' | 'firm_admin' | 'member';

/** The `user` object of the login and `/api/auth/me` responses. */
export interface User {
  id: string;
  email: string;
  role: Role;
  firmId?: string;
}

interface Session {
  token: string | null;
  signIn: (token: string) => void;
  signOut: () => void;
  /** An API call with the session's Bearer token. */
  request: <T>(path: string, options?: Omit<ApiRequestOptions, 'token'>) => Promise<T>;
}

const SessionContext = createContext<Session | null>(null);

/** Keeps the user token in `sessionStorage`: it survives a refresh and ends with the tab. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY));

  function storeToken(next: string | null) {
    // Drops every cached response, so the next user never sees the previous user's data.
    queryClient.clear();
    if (next === null) sessionStorage.removeItem(TOKEN_KEY);
    else sessionStorage.setItem(TOKEN_KEY, next);
    setToken(next);
  }

  const session: Session = {
    token,
    signIn: (next) => storeToken(next),
    signOut: () => storeToken(null),
    request: (path, options) => apiRequest(path, { ...options, token }),
  };

  return <SessionContext value={session}>{children}</SessionContext>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionProvider');
  return session;
}
