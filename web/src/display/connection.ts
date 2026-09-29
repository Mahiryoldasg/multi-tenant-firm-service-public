// One simulated display connection. DOM-free, so the Node test suite can run it against the real
// server.
import { io, type Socket } from 'socket.io-client';
import type { SimulatorEvent } from './simulator.ts';

/** What the server sends to displays (contract §4). Declared here: the UI never imports server code. */
interface ServerToClientEvents {
  'mode-change': (payload: { modeId: string }) => void;
}

/** What a display may ask (not in the contract). The answer is checked before it is used. */
interface ClientToServerEvents {
  'mode:get': (ack: (answer: unknown) => void) => void;
}

export const MODE_SYNC_TIMEOUT_MS = 5_000;
export const MODE_SYNC_TIMEOUT_REASON = 'Sunucu mode:get isteğine zamanında yanıt vermedi.';
export const UNEXPECTED_MODE_ANSWER_REASON = 'Sunucudan beklenmeyen mode:get yanıtı.';

export interface DisplayConnection {
  /** Closes the connection and stops any reconnection, reporting nothing. */
  close(): void;
}

export interface DisplayConnectionOptions {
  /** How long to wait for the answer to `mode:get`. */
  modeSyncTimeoutMs?: number;
}

/**
 * Connects in the contract's form, `io(url, { auth: { token } })`, and reports what happens. On
 * every connect it asks for the firm's current mode, since the server pushes nothing on connect.
 */
export function openDisplayConnection(
  url: string,
  token: string,
  onEvent: (event: SimulatorEvent) => void,
  { modeSyncTimeoutMs = MODE_SYNC_TIMEOUT_MS }: DisplayConnectionOptions = {},
): DisplayConnection {
  // Its own manager, so closing this connection never touches another one on the page.
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(url, {
    auth: { token },
    forceNew: true,
  });

  socket.on('connect', () => {
    onEvent({ type: 'connected' });
    socket.timeout(modeSyncTimeoutMs).emit('mode:get', (error, answer) => {
      // The client also fails a pending request when the connection closes, `close()` included.
      // The disconnect is reported already, and the next connect asks again.
      if (!socket.connected) return;
      onEvent(
        error ? { type: 'mode-sync-failed', reason: MODE_SYNC_TIMEOUT_REASON } : syncEvent(answer),
      );
    });
  });
  // The client destroys the socket before a handshake rejection or a server disconnect reaches these
  // handlers, so `active` is false exactly when it will not retry by itself.
  socket.on('connect_error', (error) => {
    onEvent(
      socket.active
        ? { type: 'connect-failed', reason: error.message }
        : { type: 'rejected', reason: error.message },
    );
  });
  socket.on('disconnect', (reason) => {
    onEvent(
      socket.active ? { type: 'connection-lost', reason } : { type: 'closed-by-server', reason },
    );
  });
  socket.on('mode-change', ({ modeId }) => onEvent({ type: 'mode-change', modeId }));

  return {
    close() {
      // Listeners go first, so the client's own `disconnect` event is not reported.
      socket.off();
      socket.disconnect();
    },
  };
}

/** `{ modeId }` is the mode; an error envelope brings its own message. */
function syncEvent(answer: unknown): SimulatorEvent {
  const modeId = field(answer, 'modeId');
  if (typeof modeId === 'string' || modeId === null) return { type: 'mode-synced', modeId };
  const message = field(field(answer, 'error'), 'message');
  return {
    type: 'mode-sync-failed',
    reason: typeof message === 'string' ? message : UNEXPECTED_MODE_ANSWER_REASON,
  };
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}
