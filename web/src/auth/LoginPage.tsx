import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { apiRequest, errorMessage } from '../api.ts';
import { useSession, type User } from './session.tsx';

interface LoginResponse {
  token: string;
  user: User;
}

export function LoginPage() {
  const { signIn, notice, clearNotice } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Not `session.request`: a 401 here is a wrong password, not an expired session.
  const login = useMutation({
    mutationFn: () =>
      apiRequest<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      }),
    onSuccess: ({ token }) => signIn(token),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearNotice();
    login.mutate();
  }

  return (
    <main className="login">
      <h1>Firma Yönetim Paneli</h1>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <form
        className="form"
        noValidate
        onSubmit={handleSubmit}
        aria-describedby={login.isError ? 'login-error' : undefined}
      >
        <h2>Giriş yap</h2>
        <label htmlFor="login-email">E-posta</label>
        <input
          id="login-email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <label htmlFor="login-password">Şifre</label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {login.isError && (
          <p id="login-error" className="error" role="alert">
            {errorMessage(login.error)}
          </p>
        )}
        <button type="submit" disabled={login.isPending}>
          {login.isPending ? 'Giriş yapılıyor...' : 'Giriş yap'}
        </button>
      </form>
    </main>
  );
}
