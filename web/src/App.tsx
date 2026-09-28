import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { RequireRole } from './auth/RequireRole.tsx';
import { RoleHome, SessionGate } from './auth/SessionGate.tsx';
import { SessionProvider } from './auth/session.tsx';
import { DisplayPage } from './display/DisplayPage.tsx';
import { FirmsPage } from './firms/FirmsPage.tsx';
import { WorkspacePage } from './workspace/WorkspacePage.tsx';

// No automatic retries: a 4xx will not change on a retry, and a 401 must end the session at once.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<SessionGate />}>
              <Route index element={<RoleHome />} />
              <Route
                path="firms"
                element={
                  <RequireRole roles={['platform_admin']}>
                    <FirmsPage />
                  </RequireRole>
                }
              />
              <Route
                path="workspace"
                element={
                  <RequireRole roles={['firm_admin', 'member']}>
                    <WorkspacePage />
                  </RequireRole>
                }
              />
            </Route>
            {/* Public: a display has no login, only its display token. */}
            <Route path="/display" element={<DisplayPage />} />
            {/* Anything else goes home, where the gate shows the login form or the role home. */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </SessionProvider>
    </QueryClientProvider>
  );
}
