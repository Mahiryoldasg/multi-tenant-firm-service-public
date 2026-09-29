import type Database from 'better-sqlite3';
import type { Express } from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pino, type Logger } from 'pino';
import { io, Manager, type Socket } from 'socket.io-client';
import request from 'supertest';
import type { Realtime } from '../../src/server/realtime/realtime.ts';
import { createTestApp } from './app.ts';
import { userTokenFor } from './auth.ts';

const WAIT_MS = 2_000;

export interface TestServer {
  app: Express;
  db: Database.Database;
  realtime: Realtime;
  url: string;
}

const clients = new Set<Socket>();

/** The real app and display channel on one HTTP server, listening on an ephemeral port. */
export async function startTestServer({
  logger = pino({ level: 'silent' }),
}: { logger?: Logger } = {}): Promise<TestServer> {
  const { app, db, realtime } = await createTestApp({ logger });
  const server = createServer(app);
  realtime.io.attach(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { app, db, realtime, url: `http://127.0.0.1:${port}` };
}

/** Closes every display client, the Socket.IO server with its HTTP server, and the DB. */
export async function stopTestServer({ db, realtime }: TestServer): Promise<void> {
  for (const client of clients) client.disconnect();
  clients.clear();
  await realtime.io.close();
  if (db.open) db.close();
}

/** A display token issued through the real `POST /api/display-tokens` by this firm admin. */
export async function issueDisplayToken(
  { app, db }: TestServer,
  adminEmail: string,
): Promise<string> {
  const res = await request(app)
    .post('/api/display-tokens')
    .set('Authorization', `Bearer ${userTokenFor(db, adminEmail)}`)
    .send({});
  if (res.status !== 201) throw new Error(`Issuing a display token answered ${res.status}`);
  return (res.body as { token: string }).token;
}

/**
 * A client in the contract's form, `io(url, { auth })`. It never shares a connection with another
 * client and never reconnects, so a dropped or rejected client stays down until teardown.
 */
export function connectDisplay(url: string, auth?: Record<string, unknown>): Socket {
  const client = io(url, { auth, forceNew: true, reconnection: false });
  clients.add(client);
  return client;
}

/**
 * A control client on `/control` (not in the contract), like `connectDisplay`: its own connection,
 * never reconnecting, closed at teardown.
 */
export function connectControl(url: string, auth?: Record<string, unknown>): Socket {
  const client = io(`${url}/control`, { auth, forceNew: true, reconnection: false });
  clients.add(client);
  return client;
}

/**
 * A display and a control client on one shared connection (one manager), so Socket.IO's order per
 * connection spans both namespaces. Neither reconnects; both close at teardown.
 */
export function connectDisplayAndControl(
  url: string,
  displayAuth: Record<string, unknown>,
  controlAuth: Record<string, unknown>,
): { display: Socket; control: Socket } {
  const manager = new Manager(url, { reconnection: false });
  const display = manager.socket('/', { auth: displayAuth });
  const control = manager.socket('/control', { auth: controlAuth });
  clients.add(display);
  clients.add(control);
  return { display, control };
}

/** Resolves once the client connects; rejects with its `connect_error` instead. */
export function connected(client: Socket): Promise<void> {
  return within('connect', (resolve, reject) => {
    client.once('connect', () => resolve());
    client.once('connect_error', reject);
  });
}

/** Resolves with the client's `connect_error`; rejects if it connects instead. */
export function rejected(client: Socket): Promise<Error> {
  return within('connect_error', (resolve, reject) => {
    client.once('connect_error', resolve);
    client.once('connect', () => reject(new Error('The display connected')));
  });
}

/** Resolves with the reason of the client's next `disconnect`. */
export function disconnected(client: Socket): Promise<string> {
  return within('disconnect', (resolve) => {
    client.once('disconnect', (reason) => resolve(reason));
  });
}

/** Resolves with the argument list of the client's next `mode-change`. */
export function nextModeChange(client: Socket): Promise<unknown[]> {
  return within('mode-change', (resolve) => {
    client.once('mode-change', (...args: unknown[]) => resolve(args));
  });
}

/** A display client and every `mode-change` it has received, recorded from before it connects. */
export interface RecordingDisplay {
  socket: Socket;
  received: unknown[][];
}

export function recordingDisplay(url: string, token: string): RecordingDisplay {
  const socket = connectDisplay(url, { token });
  return { socket, received: recordModeChanges(socket) };
}

/** Sets the mode as this firm admin through the real API and waits until `display` receives it. */
export async function setModeAndAwait(
  { app, db }: TestServer,
  adminEmail: string,
  modeId: string,
  display: RecordingDisplay,
): Promise<void> {
  const next = nextModeChange(display.socket);
  const res = await request(app)
    .post('/api/mode')
    .set('Authorization', `Bearer ${userTokenFor(db, adminEmail)}`)
    .send({ modeId });
  if (res.status !== 200) throw new Error(`Setting the mode answered ${res.status}`);
  await next;
}

/** Every `mode-change` argument list the client receives from now on, in order. */
export function recordModeChanges(client: Socket): unknown[][] {
  const received: unknown[][] = [];
  client.on('mode-change', (...args: unknown[]) => received.push(args));
  return received;
}

/** Sends `mode:get` (not in the contract), with `args` before the ack, and resolves with the answer. */
export function requestMode(client: Socket, ...args: unknown[]): Promise<unknown> {
  return client.timeout(WAIT_MS).emitWithAck('mode:get', ...args);
}

/** Resolves with the argument list of the client's next `mode:changed`. */
export function nextModeChanged(client: Socket): Promise<unknown[]> {
  return within('mode:changed', (resolve) => {
    client.once('mode:changed', (...args: unknown[]) => resolve(args));
  });
}

/** Every `mode:changed` argument list the client receives from now on, in order. */
export function recordModeChangedSignals(client: Socket): unknown[][] {
  const received: unknown[][] = [];
  client.on('mode:changed', (...args: unknown[]) => received.push(args));
  return received;
}

function within<T>(
  label: string,
  executor: (resolve: (value: T) => void, reject: (error: Error) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), WAIT_MS);
    executor(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
