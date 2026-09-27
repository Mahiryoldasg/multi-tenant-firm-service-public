import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { ApiError, apiRequest, SESSION_EXPIRED_TEXT, type ApiRequestOptions } from '../api.ts';

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
  /** Why the last session ended on its own; shown on the login page until the next submit. */
  notice: string | null;
  signIn: (token: string) => void;
  signOut: () => void;
  clearNotice: () => void;
  /** An API call with the session's Bearer token; a 401 ends the session. */
  request: <T>(path: string, options?: Omit<ApiRequestOptions, 'token'>) => Promise<T>;
}

const SessionContext = createContext<Session | null>(null);

/** Keeps the user token in `sessionStorage`: it survives a refresh and ends with the tab. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY));
  const [notice, setNotice] = useState<string | null>(null);

  function storeToken(next: string | null) {
    // Drops every cached response, so the next user never sees the previous user's data.
    queryClient.clear();
    if (next === null) sessionStorage.removeItem(TOKEN_KEY);
    else sessionStorage.setItem(TOKEN_KEY, next);
    setToken(next);
  }

  async function request<T>(path: string, options?: Omit<ApiRequestOptions, 'token'>): Promise<T> {
    try {
      return await apiRequest<T>(path, { ...options, token });
    } catch (error) {
      // The token is no longer accepted (expired, or its user or firm was deleted).
      if (error instanceof ApiError && error.status === 401) {
        storeToken(null);
        setNotice(SESSION_EXPIRED_TEXT);
      }
      throw error;
    }
  }

  const session: Session = {
    token,
    notice,
    signIn: (next) => storeToken(next),
    signOut: () => storeToken(null),
    clearNotice: () => setNotice(null),
    request,
  };

  return <SessionContext value={session}>{children}</SessionContext>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionProvider');
  return session;
}
