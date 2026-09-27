import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertUser } from '../../src/server/modules/platform/users.ts';
import { userTokenFor } from '../helpers/auth.ts';
import { TEST_SEED } from '../helpers/db.ts';
import {
  connected,
  issueDisplayToken,
  nextModeChange,
  recordingDisplay,
  type RecordingDisplay,
  setModeAndAwait,
  startTestServer,
  stopTestServer,
  type TestServer,
} from '../helpers/realtime.ts';

const MODE_PATH = '/api/mode';
const FIRST_ADMIN_EMAIL = TEST_SEED.firms[0].adminEmail;
const SECOND_ADMIN_EMAIL = TEST_SEED.firms[1].adminEmail;
const FIRST_MEMBER_EMAIL = 'Member@First.Test';
const LATER = '2999-01-01T00:00:00.000Z';

let server: TestServer;
let firstA: RecordingDisplay;
let firstB: RecordingDisplay;
let second: RecordingDisplay;

beforeEach(async () => {
  server = await startTestServer();
  const [firstToken, secondToken] = await Promise.all([
    issueDisplayToken(server, FIRST_ADMIN_EMAIL),
    issueDisplayToken(server, SECOND_ADMIN_EMAIL),
  ]);
  firstA = recordingDisplay(server.url, firstToken);
  firstB = recordingDisplay(server.url, firstToken);
  second = recordingDisplay(server.url, secondToken);
  await Promise.all([firstA, firstB, second].map(({ socket }) => connected(socket)));
});

afterEach(async () => {
  await stopTestServer(server);
});

function postMode(email: string, body: unknown) {
  return request(server.app)
    .post(MODE_PATH)
    .set('Authorization', `Bearer ${userTokenFor(server.db, email)}`)
    .send(body as object);
}

describe('POST /api/mode', () => {
  it('sends exactly the stored modeId to every display of the firm', async () => {
    const nextA = nextModeChange(firstA.socket);
    const nextB = nextModeChange(firstB.socket);

    const res = await postMode(FIRST_ADMIN_EMAIL, { modeId: '  Gece Modu  ' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ modeId: '  Gece Modu  ' });
    expect(await nextA).toEqual([{ modeId: '  Gece Modu  ' }]);
    expect(await nextB).toEqual([{ modeId: '  Gece Modu  ' }]);
  });

  it('sends the event again for the same modeId', async () => {
    await setModeAndAwait(server, FIRST_ADMIN_EMAIL, 'lobby', firstA);
    await setModeAndAwait(server, FIRST_ADMIN_EMAIL, 'lobby', firstA);

    expect(firstA.received).toEqual([[{ modeId: 'lobby' }], [{ modeId: 'lobby' }]]);
  });

  it("never reaches another firm's displays", async () => {
    await setModeAndAwait(server, FIRST_ADMIN_EMAIL, 'first-only', firstA);

    // Barrier: the second display's own event. Socket.IO keeps order per connection, so the first
    // firm's event, sent before it, would have arrived first.
    await setModeAndAwait(server, SECOND_ADMIN_EMAIL, 'second-only', second);

    expect(second.received).toEqual([[{ modeId: 'second-only' }]]);
  });
});

describe('POST /api/mode failures', () => {
  function memberToken(): string {
    insertUser(server.db, LATER, {
      firmId: firmIdOf(FIRST_ADMIN_EMAIL),
      role: 'member',
      email: FIRST_MEMBER_EMAIL,
      passwordHash: 'unused',
    });
    return userTokenFor(server.db, FIRST_MEMBER_EMAIL);
  }

  function firmIdOf(email: string): string {
    const row = server.db
      .prepare<{ email: string }, { firmId: string }>(
        'SELECT firm_id AS firmId FROM users WHERE email = @email',
      )
      .get({ email });
    if (!row) throw new Error(`No user ${email}`);
    return row.firmId;
  }

  it.each([
    {
      label: "a member's 403",
      status: 403,
      send: () =>
        request(server.app)
          .post(MODE_PATH)
          .set('Authorization', `Bearer ${memberToken()}`)
          .send({ modeId: 'member' }),
    },
    { label: 'a 400 for no modeId', status: 400, send: () => postMode(FIRST_ADMIN_EMAIL, {}) },
    {
      label: 'a 400 for a blank modeId',
      status: 400,
      send: () => postMode(FIRST_ADMIN_EMAIL, { modeId: '   ' }),
    },
    {
      label: 'a 401 without a token',
      status: 401,
      send: () => request(server.app).post(MODE_PATH).send({ modeId: 'anonymous' }),
    },
    {
      label: 'a 401 for a display token',
      status: 401,
      send: async () =>
        request(server.app)
          .post(MODE_PATH)
          .set('Authorization', `Bearer ${await issueDisplayToken(server, FIRST_ADMIN_EMAIL)}`)
          .send({ modeId: 'display' }),
    },
  ])('sends nothing on $label', async ({ status, send }) => {
    const res = await send();
    expect(res.status).toBe(status);

    // Barrier: a successful set, which the display must receive after anything sent before it.
    await setModeAndAwait(server, FIRST_ADMIN_EMAIL, 'barrier', firstA);

    expect(firstA.received).toEqual([[{ modeId: 'barrier' }]]);
  });
});
