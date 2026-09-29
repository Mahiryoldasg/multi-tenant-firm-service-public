import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSession } from '../auth/session.tsx';
import { openLiveModeConnection } from './live-mode.ts';

/** The state of the mode panel's live channel. */
export type LiveModeStatus =
  | { state: 'connecting' }
  | { state: 'live' }
  | { state: 'interrupted' }
  | { state: 'stopped'; reason: string };

/**
 * Keeps the `['mode']` query live while the panel is open: it refetches the mode over HTTP on every
 * (re)connect and every `mode:changed`, and closes the channel on unmount or sign-out.
 */
export function useLiveMode(): LiveModeStatus {
  const { token } = useSession();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveModeStatus>({ state: 'connecting' });

  // In development StrictMode opens, closes and opens the channel again, which is harmless.
  useEffect(() => {
    if (!token) return;
    const connection = openLiveModeConnection(window.location.origin, token, (event) => {
      switch (event.type) {
        case 'connected':
          setStatus({ state: 'live' });
          // No signal covers a change made while the channel was down, or between the panel's
          // first GET and the join, so every connect reads the mode again.
          void queryClient.invalidateQueries({ queryKey: ['mode'] });
          break;
        case 'mode-changed':
          // Through the session's `request`, so a 401 ends the session as any other call does.
          void queryClient.invalidateQueries({ queryKey: ['mode'] });
          break;
        case 'interrupted':
          setStatus({ state: 'interrupted' });
          break;
        case 'stopped':
          setStatus({ state: 'stopped', reason: event.reason });
          break;
      }
    });
    return () => connection.close();
  }, [token, queryClient]);

  return status;
}
