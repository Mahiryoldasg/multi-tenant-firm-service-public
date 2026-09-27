import type Database from 'better-sqlite3';
import type { Express } from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pino, type Logger } from 'pino';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { createRealtime, type Realtime } from '../../src/server/realtime/realtime.ts';
import { createTestApp, TEST_CONFIG } from './app.ts';
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
  const { app, db } = await createTestApp({ logger });
  const realtime = createRealtime({ db, config: TEST_CONFIG, logger });
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

/** Every `mode-change` argument list the client receives from now on, in order. */
export function recordModeChanges(client: Socket): unknown[][] {
  const received: unknown[][] = [];
  client.on('mode-change', (...args: unknown[]) => received.push(args));
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
