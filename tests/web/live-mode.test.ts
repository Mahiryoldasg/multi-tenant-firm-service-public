import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISPLAY_TOKEN_ON_CONTROL_MESSAGE } from '../../src/server/realtime/control-auth.ts';
import {
  LIVE_MODE_CLOSED_TEXT,
  openLiveModeConnection,
  type LiveModeConnection,
  type LiveModeEvent,
} from '../../web/src/workspace/live-mode.ts';
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
const connections: LiveModeConnection[] = [];

beforeEach(async () => {
  server = await startTestServer();
});

afterEach(async () => {
  // Closed before the server, so no reconnection loop outlives it.
  for (const connection of connections) connection.close();
  connections.length = 0;
  await stopTestServer(server);
});

/** Opens a connection as the mode panel does and records every event it reports. */
function openLiveMode(token: string) {
  const events: LiveModeEvent[] = [];
  const connection = openLiveModeConnection(server.url, token, (event) => events.push(event));
  connections.push(connection);
  return { connection, events };
}

async function openConnectedLiveMode() {
  const live = openLiveMode(userTokenFor(server.db, FIRM.adminEmail));
  await vi.waitFor(() => expect(live.events).toEqual([{ type: 'connected' }]), WAIT);
  return live;
}

function controlSockets() {
  return server.realtime.io.of('/control').sockets;
}

function firmId(name: string): string {
  const row = server.db
    .prepare<{ name: string }, { id: string }>('SELECT id FROM firms WHERE name = @name')
    .get({ name });
  if (!row) throw new Error(`No firm named ${name}`);
  return row.id;
}

describe('openLiveModeConnection', () => {
  it("reports the connection, then each mode change of the user's firm", async () => {
    const live = await openConnectedLiveMode();

    const res = await request(server.app)
      .post('/api/mode')
      .set('Authorization', `Bearer ${userTokenFor(server.db, FIRM.adminEmail)}`)
      .send({ modeId: 'lobby' });

    expect(res.status).toBe(200);
    await vi.waitFor(
      () => expect(live.events).toEqual([{ type: 'connected' }, { type: 'mode-changed' }]),
      WAIT,
    );
  });

  // The panel shows the server's message as it is, so here the message is the behavior.
  it('reports a display token as stopped with the server message, and gives up', async () => {
    const live = openLiveMode(await issueDisplayToken(server, FIRM.adminEmail));

    await vi.waitFor(
      () =>
        expect(live.events).toEqual([
          { type: 'stopped', reason: DISPLAY_TOKEN_ON_CONTROL_MESSAGE },
        ]),
      WAIT,
    );
    // A rejected client closes its transport instead of retrying.
    await vi.waitFor(() => expect(server.realtime.io.engine.clientsCount).toBe(0), WAIT);
    expect(live.events).toEqual([{ type: 'stopped', reason: DISPLAY_TOKEN_ON_CONTROL_MESSAGE }]);
  });

  it("reports the server's close as stopped when the firm is deleted", async () => {
    const live = await openConnectedLiveMode();

    const res = await request(server.app)
      .delete(`/api/firms/${firmId(FIRM.name)}`)
      .set('Authorization', `Bearer ${userTokenFor(server.db, TEST_SEED.platformAdmin.email)}`);

    expect(res.status).toBe(204);
    await vi.waitFor(
      () =>
        expect(live.events).toEqual([
          { type: 'connected' },
          { type: 'stopped', reason: LIVE_MODE_CLOSED_TEXT },
        ]),
      WAIT,
    );
  });

  it('reports a dropped transport as interrupted, then connects again by itself', async () => {
    const live = await openConnectedLiveMode();
    const [serverSocket] = controlSockets().values();
    if (!serverSocket) throw new Error('The live mode connection has no server socket');

    serverSocket.conn.close();

    await vi.waitFor(
      () =>
        expect(live.events).toEqual([
          { type: 'connected' },
          { type: 'interrupted' },
          { type: 'connected' },
        ]),
      WAIT,
    );
  });

  it('closes without reporting anything and leaves no socket on the server', async () => {
    const live = await openConnectedLiveMode();

    live.connection.close();

    await vi.waitFor(() => expect(controlSockets().size).toBe(0), WAIT);
    expect(live.events).toEqual([{ type: 'connected' }]);
  });
});
