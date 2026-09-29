// The firm workspace's live mode channel on `/control` (not in the contract). DOM-free, so the Node
// test suite can run it against the real server.
import { io, type Socket } from 'socket.io-client';

/** What the server sends to control screens. Declared here: the UI never imports server code. */
interface ServerToClientEvents {
  /** The firm's mode changed. No data: the screen reads the mode with `GET /api/mode`. */
  'mode:changed': () => void;
}

/** Shown when the server closed the channel, for example because the firm was deleted. */
export const LIVE_MODE_CLOSED_TEXT = 'Sunucu bağlantıyı kapattı.';

/** What happened to the live mode channel. */
export type LiveModeEvent =
  /** Connected, or connected again after a break. */
  | { type: 'connected' }
  | { type: 'mode-changed' }
  /** A failed attempt or a dropped connection that the client retries by itself. */
  | { type: 'interrupted' }
  /** Not retried: the server rejected the handshake, or closed the connection. */
  | { type: 'stopped'; reason: string };

export interface LiveModeConnection {
  /** Closes the connection and stops any reconnection, reporting nothing. */
  close(): void;
}

/** Connects to `/control` with the user token and reports what happens. */
export function openLiveModeConnection(
  url: string,
  token: string,
  onEvent: (event: LiveModeEvent) => void,
): LiveModeConnection {
  // Its own manager, so closing this connection never touches another one on the page.
  const socket: Socket<ServerToClientEvents> = io(`${url}/control`, {
    auth: { token },
    forceNew: true,
  });

  socket.on('connect', () => onEvent({ type: 'connected' }));
  // As in the display simulator: the client destroys the socket before a handshake rejection or a
  // server disconnect reaches these handlers, so `active` is false exactly when it will not retry.
  socket.on('connect_error', (error) => {
    onEvent(socket.active ? { type: 'interrupted' } : { type: 'stopped', reason: error.message });
  });
  socket.on('disconnect', () => {
    onEvent(
      socket.active ? { type: 'interrupted' } : { type: 'stopped', reason: LIVE_MODE_CLOSED_TEXT },
    );
  });
  socket.on('mode:changed', () => onEvent({ type: 'mode-changed' }));

  return {
    close() {
      // Listeners go first, so the client's own `disconnect` event is not reported.
      socket.off();
      socket.disconnect();
    },
  };
}
