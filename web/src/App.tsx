import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router';
import { RoleHome, SessionGate } from './auth/SessionGate.tsx';
import { SessionProvider } from './auth/session.tsx';
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
              <Route path="firms" element={<FirmsPage />} />
              <Route path="workspace" element={<WorkspacePage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </SessionProvider>
    </QueryClientProvider>
  );
}
