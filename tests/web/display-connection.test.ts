import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DISPLAY_TOKEN_REQUIRED_MESSAGE,
  INVALID_DISPLAY_TOKEN_MESSAGE,
  USER_TOKEN_ON_SOCKET_MESSAGE,
} from '../../src/server/realtime/display-auth.ts';
import { openDisplayConnection, type DisplayConnection } from '../../web/src/display/connection.ts';
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

beforeEach(async () => {
  server = await startTestServer();
});

afterEach(async () => {
  // Closed before the server, so no reconnection loop outlives it.
  for (const connection of connections) connection.close();
  connections.length = 0;
  await stopTestServer(server);
});

/** Opens a connection as the simulator page does and records every event it reports. */
function openDisplay(token: string) {
  const events: SimulatorEvent[] = [];
  const connection = openDisplayConnection(server.url, token, (event) => events.push(event));
  connections.push(connection);
  return { connection, events };
}

async function openConnectedDisplay() {
  const display = openDisplay(await issueDisplayToken(server, FIRM.adminEmail));
  await vi.waitFor(() => expect(display.events).toEqual([{ type: 'connected' }]), WAIT);
  return display;
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
          { type: 'mode-change', modeId: 'lobby' },
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
        expect(eventTypes(display.events)).toEqual(['connected', 'connection-lost', 'connected']),
      WAIT,
    );
  });

  it('closes without reporting anything and leaves no socket on the server', async () => {
    const display = await openConnectedDisplay();

    display.connection.close();

    await vi.waitFor(() => expect(server.realtime.io.of('/').sockets.size).toBe(0), WAIT);
    expect(display.events).toEqual([{ type: 'connected' }]);
  });
});
