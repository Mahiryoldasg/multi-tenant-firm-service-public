import type Database from 'better-sqlite3';
import type { Logger } from 'pino';
import { type Namespace, Server } from 'socket.io';
import type { AppConfig } from '../config.ts';
import { INTERNAL_ERROR_MESSAGE } from '../http/error-handler.ts';
import { createTenantScope } from '../tenancy/scope.ts';
import { authenticateControl } from './control-auth.ts';
import { authenticateDisplay } from './display-auth.ts';

/**
 * What the server sends. Displays on the main namespace get `mode-change` (contract §4); open
 * control screens on `/control` get `mode:changed` (not in the contract).
 */
export interface ServerToClientEvents {
  /** To a firm's displays, on the main namespace. */
  'mode-change': (payload: { modeId: string }) => void;
  /** To a firm's open control screens, on `/control`: no data, the UI reads the mode over HTTP. */
  'mode:changed': () => void;
}

/**
 * What clients may send: only displays on the main namespace are answered, and only `mode:get` (not
 * in the contract); `/control` listens to nothing. The arguments are checked at runtime.
 */
interface ClientToServerEvents {
  'mode:get': (...args: unknown[]) => void;
}

/** The `mode:get` ack: the body of `GET /api/mode`, or the envelope of an unexpected failure. */
type ModeAnswer =
  { modeId: string | null } | { error: { code: 'INTERNAL_ERROR'; message: string } };

interface SocketData {
  firmId: string;
}

export type RealtimeServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

type RealtimeNamespace = Namespace<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export interface Realtime {
  /** Created unattached; `index.ts` attaches it to the HTTP server and closes it on shutdown. */
  io: RealtimeServer;
  /**
   * The only emitter of both mode events: `mode-change` reaches the connected displays of this firm
   * only, and `mode:changed` the open control screens of this firm only.
   */
  broadcastModeChange(firmId: string, modeId: string): void;
  /** Drops every connected display and control screen of this firm, closing each one's connection. */
  disconnectFirm(firmId: string): void;
}

export interface RealtimeDeps {
  db: Database.Database;
  config: Pick<AppConfig, 'jwtSecret'>;
  logger: Logger;
}

/**
 * The display channel on the main namespace, and the control UI's live mode channel on `/control`.
 * In both, a socket joins its own firm's room, taken from the verified handshake. Displays can also
 * ask for their firm's current mode with `mode:get`.
 */
export function createRealtime({ db, config, logger }: RealtimeDeps): Realtime {
  // The UI bundles socket.io-client, so the server does not serve its own copy.
  const io: RealtimeServer = new Server({ serveClient: false });
  const displays: RealtimeNamespace = io.of('/');
  // Not in the contract. Rooms are per namespace, so a `/control` firm room never holds a display.
  const controls: RealtimeNamespace = io.of('/control');

  admitToFirmRoom(displays, {
    check: (auth) => authenticateDisplay(auth, { db, secret: config.jwtSecret }),
    logger,
    failureLog: 'Display handshake failed',
  });
  admitToFirmRoom(controls, {
    check: (auth) => authenticateControl(auth, { db, secret: config.jwtSecret }),
    logger,
    failureLog: 'Control handshake failed',
  });

  const realtime: Realtime = {
    io,
    broadcastModeChange(firmId, modeId) {
      displays.to(firmRoom(firmId)).emit('mode-change', { modeId });
      // Only a nudge: the screen reads the mode with GET /api/mode, which checks the user again.
      controls.to(firmRoom(firmId)).emit('mode:changed');
    },
    disconnectFirm(firmId) {
      displays.in(firmRoom(firmId)).disconnectSockets(true);
      controls.in(firmRoom(firmId)).disconnectSockets(true);
    },
  };

  answerModeRequests(displays, {
    readMode: (firmId) => createTenantScope(db, firmId, realtime).mode.get(),
    logger,
  });

  return realtime;
}

interface ModeRequests {
  readMode: (firmId: string) => string | null;
  logger: Logger;
}

/**
 * Answers a display's `mode:get` (not in the contract) with its own firm's mode. The firm is the one
 * the handshake fixed: nothing in the request can name another one.
 */
function answerModeRequests(
  namespace: RealtimeNamespace,
  { readMode, logger }: ModeRequests,
): void {
  namespace.on('connection', (socket) => {
    socket.on('mode:get', (...args) => {
      // Socket.IO passes the client's ack last; a request without one has nowhere to be answered.
      const ack = args.at(-1);
      if (typeof ack !== 'function') return;

      // Read and answer in one synchronous call, as POST /api/mode stores and broadcasts: a display
      // then gets this answer and any `mode-change` in the order the mode changed.
      let answer: ModeAnswer;
      try {
        answer = { modeId: readMode(socket.data.firmId) };
      } catch (err) {
        logger.error({ err }, 'Mode request failed');
        answer = { error: { code: 'INTERNAL_ERROR', message: INTERNAL_ERROR_MESSAGE } };
      }
      ack(answer);
    });
  });
}

type HandshakeResult = { ok: true; firmId: string } | { ok: false; message: string };

interface FirmRoomAdmission {
  check: (auth: unknown) => HandshakeResult;
  logger: Logger;
  failureLog: string;
}

/** Lets a socket into `namespace` only if `check` accepts its handshake, then into its firm's room. */
function admitToFirmRoom(
  namespace: RealtimeNamespace,
  { check, logger, failureLog }: FirmRoomAdmission,
): void {
  // Synchronous on purpose: Socket.IO connects the socket one `process.nextTick` after this chain,
  // so no HTTP request, such as a firm delete, can run between the live-firm check and the join.
  namespace.use((socket, next) => {
    let result;
    try {
      result = check(socket.handshake.auth);
    } catch (err) {
      // Not the handshake `auth`: it holds the token.
      logger.error({ err }, failureLog);
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

  namespace.on('connection', (socket) => {
    socket.join(firmRoom(socket.data.firmId));
  });
}

function firmRoom(firmId: string): string {
  return `firm:${firmId}`;
}
