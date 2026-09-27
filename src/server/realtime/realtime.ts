import type Database from 'better-sqlite3';
import type { Logger } from 'pino';
import { Server } from 'socket.io';
import type { AppConfig } from '../config.ts';
import { INTERNAL_ERROR_MESSAGE } from '../http/error-handler.ts';
import { authenticateDisplay } from './display-auth.ts';

/** What the server sends to displays (contract §4). Displays send nothing the server listens to. */
export interface ServerToClientEvents {
  'mode-change': (payload: { modeId: string }) => void;
}

interface SocketData {
  firmId: string;
}

export type RealtimeServer = Server<
  Record<string, never>,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export interface Realtime {
  /** Created unattached; `index.ts` attaches it to the HTTP server and closes it on shutdown. */
  io: RealtimeServer;
  /** The only emitter of `mode-change`: it reaches the connected displays of this firm only. */
  broadcastModeChange(firmId: string, modeId: string): void;
  /** Drops every connected display of this firm, closing each one's connection. */
  disconnectFirm(firmId: string): void;
}

export interface RealtimeDeps {
  db: Database.Database;
  config: Pick<AppConfig, 'jwtSecret'>;
  logger: Logger;
}

/** The display channel: a display joins its own firm's room, taken from the verified handshake. */
export function createRealtime({ db, config, logger }: RealtimeDeps): Realtime {
  // The UI bundles socket.io-client, so the server does not serve its own copy.
  const io: RealtimeServer = new Server({ serveClient: false });

  // Synchronous on purpose: Socket.IO connects the socket one `process.nextTick` after this chain,
  // so no HTTP request, such as a firm delete, can run between the live-firm check and the join.
  io.use((socket, next) => {
    let result;
    try {
      result = authenticateDisplay(socket.handshake.auth, { db, secret: config.jwtSecret });
    } catch (err) {
      // Not the handshake `auth`: it holds the token.
      logger.error({ err }, 'Display handshake failed');
      next(new Error(INTERNAL_ERROR_MESSAGE));
      return;
    }

    if (!result.ok) {
      next(new Error(result.message));
      return;
    }
    socket.data.firmId = result.firmId;
    next();
  });

  io.on('connection', (socket) => {
    socket.join(firmRoom(socket.data.firmId));
  });

  return {
    io,
    broadcastModeChange(firmId, modeId) {
      io.to(firmRoom(firmId)).emit('mode-change', { modeId });
    },
    disconnectFirm(firmId) {
      io.in(firmRoom(firmId)).disconnectSockets(true);
    },
  };
}

function firmRoom(firmId: string): string {
  return `firm:${firmId}`;
}
