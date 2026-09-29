import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AUTH_REQUIRED_MESSAGE,
  INVALID_SESSION_MESSAGE,
} from '../../src/server/http/authenticate.ts';
import { FORBIDDEN_MESSAGE } from '../../src/server/http/authorize.ts';
import { INTERNAL_ERROR_MESSAGE } from '../../src/server/http/error-handler.ts';
import { insertUser } from '../../src/server/modules/platform/users.ts';
import { DISPLAY_TOKEN_ON_CONTROL_MESSAGE } from '../../src/server/realtime/control-auth.ts';
import { USER_TOKEN_ON_SOCKET_MESSAGE } from '../../src/server/realtime/display-auth.ts';
import { userTokenFor } from '../helpers/auth.ts';
import { TEST_SEED } from '../helpers/db.ts';
import { createCapturingLogger } from '../helpers/log.ts';
import {
  connectControl,
  connectDisplay,
  connected,
  disconnected,
  issueDisplayToken,
  nextModeChange,
  nextModeChanged,
  recordModeChangedSignals,
  recordModeChanges,
  rejected,
  startTestServer,
  stopTestServer,
  type TestServer,
} from '../helpers/realtime.ts';

const MODE_PATH = '/api/mode';
const FIRST_ADMIN_EMAIL = TEST_SEED.firms[0].adminEmail;
const SECOND_ADMIN_EMAIL = TEST_SEED.firms[1].adminEmail;
const FIRST_MEMBER_EMAIL = 'Member@First.Test';
const NOW = '2026-09-29T12:00:00.000Z';

let server: TestServer | undefined;

async function start(options?: Parameters<typeof startTestServer>[0]): Promise<TestServer> {
  server = await startTestServer(options);
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

function addFirstMember(s: TestServer): string {
  return insertUser(s.db, NOW, {
    firmId: firmId(s, 'First Test Firm'),
    role: 'member',
    email: FIRST_MEMBER_EMAIL,
    passwordHash: 'unused',
  });
}

function postMode(s: TestServer, email: string, body: object) {
  return request(s.app)
    .post(MODE_PATH)
    .set('Authorization', `Bearer ${userTokenFor(s.db, email)}`)
    .send(body);
}

/** A control client of this user and every `mode:changed` it gets, recorded from before it connects. */
interface RecordingControl {
  socket: ReturnType<typeof connectControl>;
  received: unknown[][];
}

function recordingControl(s: TestServer, email: string): RecordingControl {
  const socket = connectControl(s.url, { token: userTokenFor(s.db, email) });
  return { socket, received: recordModeChangedSignals(socket) };
}

/** Sets the mode as this firm admin through the real API and waits until `control` is signalled. */
async function setModeAndAwaitSignal(
  s: TestServer,
  email: string,
  modeId: string,
  control: RecordingControl,
): Promise<void> {
  const next = nextModeChanged(control.socket);
  const res = await postMode(s, email, { modeId });
  expect(res.status).toBe(200);
  await next;
}

describe('control handshake', () => {
  beforeEach(async () => {
    await start();
  });

  it('connects a firm admin and a member of the firm', async () => {
    const s = server!;
    addFirstMember(s);
    const admin = connectControl(s.url, { token: userTokenFor(s.db, FIRST_ADMIN_EMAIL) });
    const member = connectControl(s.url, { token: userTokenFor(s.db, FIRST_MEMBER_EMAIL) });

    await Promise.all([connected(admin), connected(member)]);

    expect(admin.connected).toBe(true);
    expect(member.connected).toBe(true);
  });

  it.each([
    { label: 'no token', auth: async () => undefined, message: AUTH_REQUIRED_MESSAGE },
    {
      label: 'an invalid token',
      auth: async () => ({ token: 'not.a.jwt' }),
      message: INVALID_SESSION_MESSAGE,
    },
    {
      label: 'a display token',
      auth: async (s: TestServer) => ({ token: await issueDisplayToken(s, FIRST_ADMIN_EMAIL) }),
      message: DISPLAY_TOKEN_ON_CONTROL_MESSAGE,
    },
    {
      label: 'the platform admin',
      auth: async (s: TestServer) => ({ token: userTokenFor(s.db, TEST_SEED.platformAdmin.email) }),
      message: FORBIDDEN_MESSAGE,
    },
  ])('rejects $label with connect_error', async ({ auth, message }) => {
    const s = server!;
    const control = connectControl(s.url, await auth(s));

    const error = await rejected(control);

    expect(error.message).toBe(message);
    expect(control.connected).toBe(false);
  });

  it('rejects a member deleted through the API', async () => {
    const s = server!;
    const memberId = addFirstMember(s);
    const token = userTokenFor(s.db, FIRST_MEMBER_EMAIL);
    const res = await request(s.app)
      .delete(`/api/employees/${memberId}`)
      .set('Authorization', `Bearer ${userTokenFor(s.db, FIRST_ADMIN_EMAIL)}`);
    expect(res.status).toBe(204);

    const error = await rejected(connectControl(s.url, { token }));

    expect(error.message).toBe(INVALID_SESSION_MESSAGE);
  });

  it('leaves the display channel closed to the user token that /control accepts', async () => {
    const s = server!;
    const token = userTokenFor(s.db, FIRST_ADMIN_EMAIL);

    await connected(connectControl(s.url, { token }));
    const error = await rejected(connectDisplay(s.url, { token }));

    expect(error.message).toBe(USER_TOKEN_ON_SOCKET_MESSAGE);
  });
});

describe('control handshake failure', () => {
  it('rejects with the generic message and logs the error without the token', async () => {
    const { logger, output } = createCapturingLogger();
    const s = await start({ logger });
    const token = userTokenFor(s.db, FIRST_ADMIN_EMAIL);
    s.db.close();

    const error = await rejected(connectControl(s.url, { token }));

    expect(error.message).toBe(INTERNAL_ERROR_MESSAGE);
    // Parsed rather than matched as text, as in the display handshake test.
    const lines = output()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.filter(({ msg }) => msg === 'Control handshake failed')).toEqual([
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

describe('control screens', () => {
  let firstAdmin: RecordingControl;
  let firstMember: RecordingControl;
  let second: RecordingControl;

  beforeEach(async () => {
    const s = await start();
    addFirstMember(s);
    firstAdmin = recordingControl(s, FIRST_ADMIN_EMAIL);
    firstMember = recordingControl(s, FIRST_MEMBER_EMAIL);
    second = recordingControl(s, SECOND_ADMIN_EMAIL);
    await Promise.all([firstAdmin, firstMember, second].map(({ socket }) => connected(socket)));
  });

  it('get nothing on connect, then one argument-free mode:changed per successful POST', async () => {
    const s = server!;
    const signalled = [nextModeChanged(firstAdmin.socket), nextModeChanged(firstMember.socket)];

    const res = await postMode(s, FIRST_ADMIN_EMAIL, { modeId: 'lobby' });
    await Promise.all(signalled);

    expect(res.status).toBe(200);
    expect(firstAdmin.received).toEqual([[]]);
    expect(firstMember.received).toEqual([[]]);
  });

  it('get the signal again for the same modeId', async () => {
    const s = server!;

    await setModeAndAwaitSignal(s, FIRST_ADMIN_EMAIL, 'lobby', firstAdmin);
    await setModeAndAwaitSignal(s, FIRST_ADMIN_EMAIL, 'lobby', firstAdmin);

    expect(firstAdmin.received).toEqual([[], []]);
  });

  it.each([
    {
      label: "a member's 403",
      status: 403,
      send: (s: TestServer) => postMode(s, FIRST_MEMBER_EMAIL, { modeId: 'member' }),
    },
    {
      label: 'a 400 for a blank modeId',
      status: 400,
      send: (s: TestServer) => postMode(s, FIRST_ADMIN_EMAIL, { modeId: '   ' }),
    },
  ])('get nothing on $label', async ({ status, send }) => {
    const s = server!;
    const res = await send(s);
    expect(res.status).toBe(status);

    // Barrier: a successful set, which the screen must receive after anything sent before it.
    await setModeAndAwaitSignal(s, FIRST_ADMIN_EMAIL, 'barrier', firstAdmin);

    expect(firstAdmin.received).toEqual([[]]);
  });

  it("never get another firm's signal", async () => {
    const s = server!;

    await setModeAndAwaitSignal(s, FIRST_ADMIN_EMAIL, 'first-one', firstAdmin);
    await setModeAndAwaitSignal(s, SECOND_ADMIN_EMAIL, 'second-only', second);
    await setModeAndAwaitSignal(s, FIRST_ADMIN_EMAIL, 'first-two', firstAdmin);

    expect(firstAdmin.received).toEqual([[], []]);
    expect(second.received).toEqual([[]]);
  });

  it('never get mode-change, and displays never get mode:changed', async () => {
    const s = server!;
    const display = connectDisplay(s.url, { token: await issueDisplayToken(s, FIRST_ADMIN_EMAIL) });
    const displayModes = recordModeChanges(display);
    const displaySignals = recordModeChangedSignals(display);
    const controlModes = recordModeChanges(firstAdmin.socket);
    await connected(display);

    // Awaiting both events of the second POST is the barrier for anything the first one leaked.
    for (const modeId of ['one', 'two']) {
      const received = [nextModeChange(display), nextModeChanged(firstAdmin.socket)];
      const res = await postMode(s, FIRST_ADMIN_EMAIL, { modeId });
      expect(res.status).toBe(200);
      await Promise.all(received);
    }

    expect(displayModes).toEqual([[{ modeId: 'one' }], [{ modeId: 'two' }]]);
    expect(displaySignals).toEqual([]);
    expect(controlModes).toEqual([]);
    expect(firstAdmin.received).toEqual([[], []]);
  });

  it("are dropped with their firm, and the other firm's stay", async () => {
    const s = server!;
    const token = userTokenFor(s.db, FIRST_ADMIN_EMAIL);
    const dropped = [disconnected(firstAdmin.socket), disconnected(firstMember.socket)];

    const res = await request(s.app)
      .delete(`/api/firms/${firmId(s, 'First Test Firm')}`)
      .set('Authorization', `Bearer ${userTokenFor(s.db, TEST_SEED.platformAdmin.email)}`);

    expect(res.status).toBe(204);
    expect(await Promise.all(dropped)).toEqual(['io server disconnect', 'io server disconnect']);
    await setModeAndAwaitSignal(s, SECOND_ADMIN_EMAIL, 'still-here', second);
    expect(second.received).toEqual([[]]);
    const error = await rejected(connectControl(s.url, { token }));
    expect(error.message).toBe(INVALID_SESSION_MESSAGE);
  });
});
