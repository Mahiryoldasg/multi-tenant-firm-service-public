import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DISPLAY_TOKEN_REQUIRED_MESSAGE,
  INVALID_DISPLAY_TOKEN_MESSAGE,
  USER_TOKEN_ON_SOCKET_MESSAGE,
} from '../../src/server/realtime/display-auth.ts';
import {
  MODE_SYNC_TIMEOUT_REASON,
  openDisplayConnection,
  UNEXPECTED_MODE_ANSWER_REASON,
  type DisplayConnection,
  type DisplayConnectionOptions,
} from '../../web/src/display/connection.ts';
import type { SimulatorEvent } from '../../web/src/display/simulator.ts';
import { userTokenFor } from '../helpers/auth.ts';
import { TEST_SEED } from '../helpers/db.ts';
import {
  issueDisplayToken,
  startTestServer,
  stopTestServer,
  type TestServer,
} from '../helpers/realtime.ts';

const FIRM = TEST_SEED.firms[0];
// Room for the client's first automatic reconnect, which waits up to 1.5 s.
const WAIT = { timeout: 5_000 };

let server: TestServer;
const connections: DisplayConnection[] = [];
const stubs: Server[] = [];

beforeEach(async () => {
  server = await startTestServer();
});

afterEach(async () => {
  // Closed before the servers, so no reconnection loop outlives them.
  for (const connection of connections) connection.close();
  connections.length = 0;
  await stopTestServer(server);
  await Promise.all(stubs.map((stub) => stub.close()));
  stubs.length = 0;
});

/** Opens a connection as the simulator page does and records every event it reports. */
function openDisplay(token: string, url = server.url, options?: DisplayConnectionOptions) {
  const events: SimulatorEvent[] = [];
  const connection = openDisplayConnection(url, token, (event) => events.push(event), options);
  connections.push(connection);
  return { connection, events };
}

async function openConnectedDisplay() {
  const display = openDisplay(await issueDisplayToken(server, FIRM.adminEmail));
  await vi.waitFor(
    () =>
      expect(display.events).toEqual([
        { type: 'connected' },
        { type: 'mode-synced', modeId: null },
      ]),
    WAIT,
  );
  return display;
}

async function setMode(modeId: string): Promise<void> {
  const res = await request(server.app)
    .post('/api/mode')
    .set('Authorization', `Bearer ${userTokenFor(server.db, FIRM.adminEmail)}`)
    .send({ modeId });
  expect(res.status).toBe(200);
}

/**
 * A bare Socket.IO server that admits any client and hands each `mode:get` ack to `answer`, so a
 * case can answer late, wrongly or never, which the real server does not.
 */
async function startStub(answer: (ack: (value: unknown) => void) => void) {
  const httpServer = createServer();
  const stub = new Server(httpServer);
  stubs.push(stub);
  stub.on('connection', (socket) => socket.on('mode:get', answer));
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address() as AddressInfo;
  return { stub, url: `http://127.0.0.1:${port}` };
}

function eventTypes(events: SimulatorEvent[]) {
  return events.map((event) => event.type);
}

function firmId(name: string): string {
  const row = server.db
    .prepare<{ name: string }, { id: string }>('SELECT id FROM firms WHERE name = @name')
    .get({ name });
  if (!row) throw new Error(`No firm named ${name}`);
  return row.id;
}

describe('openDisplayConnection', () => {
  it("reports the connection, then each mode-change of the token's firm", async () => {
    const display = await openConnectedDisplay();

    const res = await request(server.app)
      .post('/api/mode')
      .set('Authorization', `Bearer ${userTokenFor(server.db, FIRM.adminEmail)}`)
      .send({ modeId: 'lobby' });

    expect(res.status).toBe(200);
    await vi.waitFor(
      () =>
        expect(display.events).toEqual([
          { type: 'connected' },
          { type: 'mode-synced', modeId: null },
          { type: 'mode-change', modeId: 'lobby' },
        ]),
      WAIT,
    );
  });

  it("asks for the firm's current mode on connect", async () => {
    await setMode('  lobby  ');

    const display = openDisplay(await issueDisplayToken(server, FIRM.adminEmail));

    await vi.waitFor(
      () =>
        expect(display.events).toEqual([
          { type: 'connected' },
          { type: 'mode-synced', modeId: '  lobby  ' },
        ]),
      WAIT,
    );
  });

  // The simulator shows the server's message as it is, so here the message is the behavior.
  it.each([
    ['a user token', () => userTokenFor(server.db, FIRM.adminEmail), USER_TOKEN_ON_SOCKET_MESSAGE],
    ['an empty token', () => '', DISPLAY_TOKEN_REQUIRED_MESSAGE],
    ['a garbage token', () => 'not-a-token', INVALID_DISPLAY_TOKEN_MESSAGE],
  ])(
    'reports %s as rejected with the server message, and gives up',
    async (_label, token, message) => {
      const display = openDisplay(token());

      await vi.waitFor(
        () => expect(display.events).toEqual([{ type: 'rejected', reason: message }]),
        WAIT,
      );
      // A rejected client closes its transport instead of retrying.
      await vi.waitFor(() => expect(server.realtime.io.engine.clientsCount).toBe(0), WAIT);
      expect(display.events).toEqual([{ type: 'rejected', reason: message }]);
    },
  );

  it("reports the server's close when the firm is deleted", async () => {
    const display = await openConnectedDisplay();

    const res = await request(server.app)
      .delete(`/api/firms/${firmId(FIRM.name)}`)
      .set('Authorization', `Bearer ${userTokenFor(server.db, TEST_SEED.platformAdmin.email)}`);

    expect(res.status).toBe(204);
    await vi.waitFor(
      () =>
        expect(display.events).toEqual([
          { type: 'connected' },
          { type: 'mode-synced', modeId: null },
          { type: 'closed-by-server', reason: 'io server disconnect' },
        ]),
      WAIT,
    );
  });

  it('reports a dropped transport as lost, then reconnects by itself', async () => {
    const display = await openConnectedDisplay();
    const [serverSocket] = server.realtime.io.of('/').sockets.values();
    if (!serverSocket) throw new Error('The display has no server socket');

    serverSocket.conn.close();

    await vi.waitFor(
      () =>
        expect(eventTypes(display.events)).toEqual([
          'connected',
          'mode-synced',
          'connection-lost',
          'connected',
          'mode-synced',
        ]),
      WAIT,
    );
  });

  it('asks again after a reconnect, and reports the mode set while it was away', async () => {
    const display = await openConnectedDisplay();
    const [serverSocket] = server.realtime.io.of('/').sockets.values();
    if (!serverSocket) throw new Error('The display has no server socket');

    serverSocket.conn.close();
    // The client waits at least half a second before its first reconnect, so the mode is set while
    // it is away and no `mode-change` can bring it.
    await vi.waitFor(() => expect(eventTypes(display.events)).toContain('connection-lost'), WAIT);
    await setMode('night');

    await vi.waitFor(
      () =>
        expect(display.events.slice(2)).toEqual([
          { type: 'connection-lost', reason: 'transport close' },
          { type: 'connected' },
          { type: 'mode-synced', modeId: 'night' },
        ]),
      WAIT,
    );
  });

  it('closes without reporting anything and leaves no socket on the server', async () => {
    const display = await openConnectedDisplay();

    display.connection.close();

    await vi.waitFor(() => expect(server.realtime.io.of('/').sockets.size).toBe(0), WAIT);
    expect(display.events).toEqual([{ type: 'connected' }, { type: 'mode-synced', modeId: null }]);
  });
});

describe('openDisplayConnection with a server that answers mode:get badly', () => {
  it('reports a request left unanswered, and stays connected', async () => {
    const { url } = await startStub(() => {});

    const display = openDisplay('any', url, { modeSyncTimeoutMs: 100 });

    await vi.waitFor(
      () =>
        expect(display.events).toEqual([
          { type: 'connected' },
          { type: 'mode-sync-failed', reason: MODE_SYNC_TIMEOUT_REASON },
        ]),
      WAIT,
    );
  });

  it("reports an error envelope's message", async () => {
    const { url } = await startStub((ack) =>
      ack({ error: { code: 'INTERNAL_ERROR', message: 'Sunucu hatası.' } }),
    );

    const display = openDisplay('any', url);

    await vi.waitFor(
      () =>
        expect(display.events).toEqual([
          { type: 'connected' },
          { type: 'mode-sync-failed', reason: 'Sunucu hatası.' },
        ]),
      WAIT,
    );
  });

  it.each([
    ['an empty object', {}],
    ['a numeric modeId', { modeId: 42 }],
    ['a bare string', 'lobby'],
    ['an error without a message', { error: { code: 'INTERNAL_ERROR' } }],
  ])('reports %s as an unexpected answer', async (_label, answer) => {
    const { url } = await startStub((ack) => ack(answer));

    const display = openDisplay('any', url);

    await vi.waitFor(
      () =>
        expect(display.events).toEqual([
          { type: 'connected' },
          { type: 'mode-sync-failed', reason: UNEXPECTED_MODE_ANSWER_REASON },
        ]),
      WAIT,
    );
  });

  it('reports nothing for a pending request when the user closes the connection', async () => {
    const { stub, url } = await startStub(() => {});
    const display = openDisplay('any', url);
    await vi.waitFor(() => expect(display.events).toEqual([{ type: 'connected' }]), WAIT);

    display.connection.close();

    await vi.waitFor(() => expect(stub.of('/').sockets.size).toBe(0), WAIT);
    expect(display.events).toEqual([{ type: 'connected' }]);
  });

  it('reports only the close for a pending request when the server closes the connection', async () => {
    const { stub, url } = await startStub(() => {});
    const display = openDisplay('any', url);
    await vi.waitFor(() => expect(display.events).toEqual([{ type: 'connected' }]), WAIT);

    stub.disconnectSockets(true);

    // The client fails the pending request right after it reports the close, in the same call.
    await vi.waitFor(
      () =>
        expect(display.events).toEqual([
          { type: 'connected' },
          { type: 'closed-by-server', reason: 'io server disconnect' },
        ]),
      WAIT,
    );
  });
});
