import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { INTERNAL_ERROR_MESSAGE } from '../../src/server/http/error-handler.ts';
import { userTokenFor } from '../helpers/auth.ts';
import { TEST_SEED } from '../helpers/db.ts';
import { createCapturingLogger } from '../helpers/log.ts';
import {
  connectControl,
  connected,
  issueDisplayToken,
  nextModeChange,
  nextModeChanged,
  recordingDisplay,
  recordModeChangedSignals,
  requestMode,
  setModeAndAwait,
  startTestServer,
  stopTestServer,
  type RecordingDisplay,
  type TestServer,
} from '../helpers/realtime.ts';

const FIRST_ADMIN_EMAIL = TEST_SEED.firms[0].adminEmail;
const SECOND_ADMIN_EMAIL = TEST_SEED.firms[1].adminEmail;

let server: TestServer | undefined;

async function start(options?: Parameters<typeof startTestServer>[0]): Promise<TestServer> {
  server = await startTestServer(options);
  return server;
}

afterEach(async () => {
  if (server) await stopTestServer(server);
  server = undefined;
});

async function connectedDisplay(
  s: TestServer,
  adminEmail = FIRST_ADMIN_EMAIL,
): Promise<RecordingDisplay & { token: string }> {
  const token = await issueDisplayToken(s, adminEmail);
  const display = recordingDisplay(s.url, token);
  await connected(display.socket);
  return { ...display, token };
}

async function setMode({ app, db }: TestServer, adminEmail: string, modeId: string): Promise<void> {
  const res = await request(app)
    .post('/api/mode')
    .set('Authorization', `Bearer ${userTokenFor(db, adminEmail)}`)
    .send({ modeId });
  expect(res.status).toBe(200);
}

function firmId({ db }: TestServer, name: string): string {
  const row = db
    .prepare<{ name: string }, { id: string }>('SELECT id FROM firms WHERE name = @name')
    .get({ name });
  if (!row) throw new Error(`No firm named ${name}`);
  return row.id;
}

describe('mode:get', () => {
  it('answers { modeId: null } when the firm never set a mode', async () => {
    const s = await start();
    const display = await connectedDisplay(s);

    expect(await requestMode(display.socket)).toStrictEqual({ modeId: null });
  });

  it('answers the mode exactly as stored, untrimmed', async () => {
    const s = await start();
    await setMode(s, FIRST_ADMIN_EMAIL, '  lobby  ');
    const display = await connectedDisplay(s);

    expect(await requestMode(display.socket)).toStrictEqual({ modeId: '  lobby  ' });
  });

  it('answers every request with the mode stored at that time', async () => {
    const s = await start();
    const display = await connectedDisplay(s);

    await setModeAndAwait(s, FIRST_ADMIN_EMAIL, 'first', display);
    expect(await requestMode(display.socket)).toStrictEqual({ modeId: 'first' });

    await setModeAndAwait(s, FIRST_ADMIN_EMAIL, 'second', display);
    expect(await requestMode(display.socket)).toStrictEqual({ modeId: 'second' });
    expect(await requestMode(display.socket)).toStrictEqual({ modeId: 'second' });
  });

  it("emits no event to the asking display or to the firm's other displays and control screens", async () => {
    const s = await start();
    const asking = await connectedDisplay(s);
    const other = await connectedDisplay(s);
    const control = connectControl(s.url, { token: userTokenFor(s.db, FIRST_ADMIN_EMAIL) });
    const signals = recordModeChangedSignals(control);
    await connected(control);

    await requestMode(asking.socket);
    await requestMode(asking.socket);

    // Barrier: the server answered both requests before this broadcast, and Socket.IO keeps order
    // per connection, so an event sent while answering would have arrived first.
    const otherNext = nextModeChange(other.socket);
    const controlNext = nextModeChanged(control);
    await setModeAndAwait(s, FIRST_ADMIN_EMAIL, 'barrier', asking);
    await Promise.all([otherNext, controlNext]);
    expect(asking.received).toEqual([[{ modeId: 'barrier' }]]);
    expect(other.received).toEqual([[{ modeId: 'barrier' }]]);
    expect(signals).toEqual([[]]);
  });

  it('is not answered on /control', async () => {
    const s = await start();
    const control = connectControl(s.url, { token: userTokenFor(s.db, FIRST_ADMIN_EMAIL) });
    const signals = recordModeChangedSignals(control);
    await connected(control);
    const serverSide = s.realtime.io.of('/control').sockets.get(control.id ?? '');
    if (!serverSide) throw new Error('No server-side socket for the control client');
    // Added after any listener the server registered on connection, so it runs after them in the
    // same emit: once it has run, an answer would already be written.
    const read = new Promise<void>((resolve) => serverSide.on('mode:get', () => resolve()));

    const answers: unknown[] = [];
    control.emit('mode:get', (answer: unknown) => answers.push(answer));
    await read;

    // Barrier: an answer written before this signal would have arrived first.
    const next = nextModeChanged(control);
    s.realtime.broadcastModeChange(firmId(s, 'First Test Firm'), 'barrier');
    await next;
    expect(answers).toEqual([]);
    expect(signals).toEqual([[]]);
  });

  it('ignores a request without an ack and keeps the display connected', async () => {
    const { logger, output } = createCapturingLogger();
    const s = await start({ logger });
    const display = await connectedDisplay(s);

    display.socket.emit('mode:get');
    display.socket.emit('mode:get', 'not an ack');

    // Answered after the two requests above, which the server read first.
    expect(await requestMode(display.socket)).toStrictEqual({ modeId: null });
    expect(display.socket.connected).toBe(true);
    expect(output()).not.toContain('Mode request failed');
  });

  it("answers the display's own firm, whatever the request names", async () => {
    const s = await start();
    await setMode(s, FIRST_ADMIN_EMAIL, 'first-mode');
    await setMode(s, SECOND_ADMIN_EMAIL, 'second-mode');
    const secondFirmId = firmId(s, 'Second Test Firm');
    const display = await connectedDisplay(s, FIRST_ADMIN_EMAIL);

    expect(await requestMode(display.socket, { firmId: secondFirmId })).toStrictEqual({
      modeId: 'first-mode',
    });
    expect(await requestMode(display.socket, secondFirmId)).toStrictEqual({
      modeId: 'first-mode',
    });
  });
});

describe('mode:get failure', () => {
  it('answers INTERNAL_ERROR and logs the error without the token', async () => {
    const { logger, output } = createCapturingLogger();
    const s = await start({ logger });
    const display = await connectedDisplay(s);
    s.db.close();

    expect(await requestMode(display.socket)).toStrictEqual({
      error: { code: 'INTERNAL_ERROR', message: INTERNAL_ERROR_MESSAGE },
    });
    const lines = output()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.filter(({ msg }) => msg === 'Mode request failed')).toEqual([
      expect.objectContaining({
        level: 50,
        err: expect.objectContaining({
          type: 'TypeError',
          message: 'The database connection is not open',
        }),
      }),
    ]);
    expect(output()).not.toContain(display.token);
  });
});
