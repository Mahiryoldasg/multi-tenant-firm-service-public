import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INTERNAL_ERROR_MESSAGE } from '../../src/server/http/error-handler.ts';
import { softDeleteFirm } from '../../src/server/modules/platform/firms.ts';
import {
  DISPLAY_TOKEN_REQUIRED_MESSAGE,
  INVALID_DISPLAY_TOKEN_MESSAGE,
  USER_TOKEN_ON_SOCKET_MESSAGE,
} from '../../src/server/realtime/display-auth.ts';
import { userTokenFor } from '../helpers/auth.ts';
import { TEST_SEED } from '../helpers/db.ts';
import { createCapturingLogger } from '../helpers/log.ts';
import {
  connectDisplay,
  connected,
  issueDisplayToken,
  nextModeChange,
  recordModeChanges,
  rejected,
  startTestServer,
  stopTestServer,
  type TestServer,
} from '../helpers/realtime.ts';

const FIRST_ADMIN_EMAIL = TEST_SEED.firms[0].adminEmail;
const SECOND_ADMIN_EMAIL = TEST_SEED.firms[1].adminEmail;
const NOW = '2026-09-27T12:00:00.000Z';

let server: TestServer | undefined;
let firstFirmId: string;
let secondFirmId: string;

async function start(options?: Parameters<typeof startTestServer>[0]): Promise<TestServer> {
  server = await startTestServer(options);
  firstFirmId = firmId(server, 'First Test Firm');
  secondFirmId = firmId(server, 'Second Test Firm');
  return server;
}

afterEach(async () => {
  if (server) await stopTestServer(server);
  server = undefined;
});

function firmId({ db }: TestServer, name: string): string {
  const row = db
    .prepare<{ name: string }, { id: string }>('SELECT id FROM firms WHERE name = @name')
    .get({ name });
  if (!row) throw new Error(`No firm named ${name}`);
  return row.id;
}

describe('display handshake', () => {
  beforeEach(async () => {
    await start();
  });

  it('connects a display token issued by a firm admin', async () => {
    const s = server!;
    const display = connectDisplay(s.url, { token: await issueDisplayToken(s, FIRST_ADMIN_EMAIL) });

    await connected(display);

    expect(display.connected).toBe(true);
  });

  it.each([
    { label: 'no token', auth: () => undefined, message: DISPLAY_TOKEN_REQUIRED_MESSAGE },
    {
      label: "a firm admin's user token",
      auth: (s: TestServer) => ({ token: userTokenFor(s.db, FIRST_ADMIN_EMAIL) }),
      message: USER_TOKEN_ON_SOCKET_MESSAGE,
    },
    {
      label: 'an invalid token',
      auth: () => ({ token: 'not.a.jwt' }),
      message: INVALID_DISPLAY_TOKEN_MESSAGE,
    },
  ])('rejects $label with connect_error', async ({ auth, message }) => {
    const s = server!;
    const display = connectDisplay(s.url, auth(s));

    const error = await rejected(display);

    expect(error.message).toBe(message);
    expect(display.connected).toBe(false);
  });

  it("rejects a deleted firm's display token with connect_error", async () => {
    const s = server!;
    const token = await issueDisplayToken(s, FIRST_ADMIN_EMAIL);
    softDeleteFirm(s.db, NOW, firstFirmId);

    const error = await rejected(connectDisplay(s.url, { token }));

    expect(error.message).toBe(INVALID_DISPLAY_TOKEN_MESSAGE);
  });
});

describe('display handshake failure', () => {
  it('rejects with the generic message and logs the error without the token', async () => {
    const { logger, output } = createCapturingLogger();
    const s = await start({ logger });
    const token = await issueDisplayToken(s, FIRST_ADMIN_EMAIL);
    s.db.close();

    const error = await rejected(connectDisplay(s.url, { token }));

    expect(error.message).toBe(INTERNAL_ERROR_MESSAGE);
    // Parsed rather than matched as text: the capturing logger records from `debug`, so a substring
    // would also pass at a level the default `info` hides, or without the error.
    const lines = output()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.filter(({ msg }) => msg === 'Display handshake failed')).toEqual([
      expect.objectContaining({
        level: 50,
        err: expect.objectContaining({
          type: 'TypeError',
          message: 'The database connection is not open',
        }),
      }),
    ]);
    expect(output()).not.toContain(token);
  });
});

describe('firm rooms', () => {
  beforeEach(async () => {
    await start();
  });

  /** One display per firm, each recording its events from before it connects. */
  async function connectBothFirms() {
    const s = server!;
    const [firstToken, secondToken] = await Promise.all([
      issueDisplayToken(s, FIRST_ADMIN_EMAIL),
      issueDisplayToken(s, SECOND_ADMIN_EMAIL),
    ]);
    const first = connectDisplay(s.url, { token: firstToken });
    const second = connectDisplay(s.url, { token: secondToken });
    const firstReceived = recordModeChanges(first);
    const secondReceived = recordModeChanges(second);
    await Promise.all([connected(first), connected(second)]);
    return { first, second, firstReceived, secondReceived };
  }

  it("reaches only the firm's own displays, with exactly { modeId }", async () => {
    const { realtime } = server!;
    const { first, second, secondReceived } = await connectBothFirms();

    const firstNext = nextModeChange(first);
    realtime.broadcastModeChange(firstFirmId, 'Gece Modu');
    expect(await firstNext).toEqual([{ modeId: 'Gece Modu' }]);

    // Barrier: the second display's own event. Socket.IO keeps order per connection, so an event
    // for the first firm, sent before it, would have arrived first.
    const secondNext = nextModeChange(second);
    realtime.broadcastModeChange(secondFirmId, 'Gündüz');
    await secondNext;
    expect(secondReceived).toEqual([[{ modeId: 'Gündüz' }]]);
  });

  it('pushes nothing when a display connects', async () => {
    const { realtime } = server!;
    const { first, firstReceived } = await connectBothFirms();

    const firstNext = nextModeChange(first);
    realtime.broadcastModeChange(firstFirmId, 'barrier');
    await firstNext;

    expect(firstReceived).toEqual([[{ modeId: 'barrier' }]]);
  });

  it("ignores a display's own attempts to join or broadcast to another firm", async () => {
    const { realtime } = server!;
    const { first, second, firstReceived, secondReceived } = await connectBothFirms();

    // Wait until the server has read both packets, so the broadcasts below come after them.
    const serverSide = realtime.io.of('/').sockets.get(second.id ?? '');
    if (!serverSide) throw new Error('No server-side socket for the second display');
    const seen = new Promise<void>((resolve) => {
      serverSide.onAny((event: string) => {
        if (event === 'mode-change') resolve();
      });
    });
    second.emit('join', `firm:${firstFirmId}`);
    second.emit('mode-change', { modeId: 'forged' });
    await seen;

    const firstNext = nextModeChange(first);
    realtime.broadcastModeChange(firstFirmId, 'first-only');
    await firstNext;
    const secondNext = nextModeChange(second);
    realtime.broadcastModeChange(secondFirmId, 'second-only');
    await secondNext;

    expect(firstReceived).toEqual([[{ modeId: 'first-only' }]]);
    expect(secondReceived).toEqual([[{ modeId: 'second-only' }]]);
  });
});
