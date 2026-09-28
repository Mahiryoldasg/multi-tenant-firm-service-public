// One simulated display connection. DOM-free, so the Node test suite can run it against the real
// server.
import { io, type Socket } from 'socket.io-client';
import type { SimulatorEvent } from './simulator.ts';

/** What the server sends to displays (contract §4). Declared here: the UI never imports server code. */
interface ServerToClientEvents {
  'mode-change': (payload: { modeId: string }) => void;
}

export interface DisplayConnection {
  /** Closes the connection and stops any reconnection, reporting nothing. */
  close(): void;
}

/** Connects in the contract's form, `io(url, { auth: { token } })`, and reports what happens. */
export function openDisplayConnection(
  url: string,
  token: string,
  onEvent: (event: SimulatorEvent) => void,
): DisplayConnection {
  // Its own manager, so closing this connection never touches another one on the page.
  const socket: Socket<ServerToClientEvents> = io(url, { auth: { token }, forceNew: true });

  socket.on('connect', () => onEvent({ type: 'connected' }));
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
