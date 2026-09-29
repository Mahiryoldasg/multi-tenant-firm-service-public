import request from 'supertest';
import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { insertUser } from '../../src/server/modules/platform/users.ts';
import { userTokenFor } from '../helpers/auth.ts';
import { TEST_SEED } from '../helpers/db.ts';
import {
  connectDisplayAndControl,
  connected,
  issueDisplayToken,
  recordingDisplay,
  type RecordingDisplay,
  recordModeChangedSignals,
  recordModeChanges,
  requestMode,
  startTestServer,
  stopTestServer,
  type TestServer,
} from '../helpers/realtime.ts';

// Contract §4 and §5: several displays per firm, both firms connected at once, and no event ever
// reaches another firm's display.

type FirmKey = 'first' | 'second';

const ADMIN_EMAILS: Record<FirmKey, string> = {
  first: TEST_SEED.firms[0].adminEmail,
  second: TEST_SEED.firms[1].adminEmail,
};

// Both firms send `shared`, and each sends one modeId twice in a row: the payload alone cannot tell
// the firms apart, and an unchanged mode is broadcast again.
const SEQUENCES: Record<FirmKey, string[]> = {
  first: ['first-lobby', 'shared', 'shared', 'first-night'],
  second: ['shared', 'second-lobby', 'second-lobby', 'second-night'],
};
const SENTINELS: Record<FirmKey, string> = { first: 'first-done', second: 'second-done' };
const FIRM_KEYS: FirmKey[] = ['first', 'second'];
const FIRM_NAMES: Record<FirmKey, string> = {
  first: TEST_SEED.firms[0].name,
  second: TEST_SEED.firms[1].name,
};
const MEMBER_EMAILS: Record<FirmKey, string> = {
  first: 'Member@First.Test',
  second: 'member@second.test',
};
const LATER = '2999-01-01T00:00:00.000Z';

let server: TestServer;
let displays: Record<FirmKey, RecordingDisplay[]>;

beforeEach(async () => {
  server = await startTestServer();
  displays = { first: await connectDisplays('first'), second: await connectDisplays('second') };
});

afterEach(async () => {
  await stopTestServer(server);
});

/** Three displays of one firm: two share a token, the third has its own. */
async function connectDisplays(firm: FirmKey): Promise<RecordingDisplay[]> {
  const shared = await issueDisplayToken(server, ADMIN_EMAILS[firm]);
  const own = await issueDisplayToken(server, ADMIN_EMAILS[firm]);
  const firmDisplays = [shared, shared, own].map((token) => recordingDisplay(server.url, token));
  await Promise.all(firmDisplays.map(({ socket }) => connected(socket)));
  return firmDisplays;
}

async function setMode(firm: FirmKey, modeId: string): Promise<void> {
  const res = await request(server.app)
    .post('/api/mode')
    .set('Authorization', `Bearer ${userTokenFor(server.db, ADMIN_EMAILS[firm])}`)
    .send({ modeId });
  expect(res.status).toBe(200);
}

/** Posts the firm's sequence in order, each request after the previous one answered. */
async function postSequence(firm: FirmKey): Promise<void> {
  for (const modeId of SEQUENCES[firm]) await setMode(firm, modeId);
}

/**
 * Barrier: each firm's own final event, posted after everything before it was answered. Socket.IO
 * keeps order per connection, so an earlier event that reached a display at all arrived before this
 * one. It waits for this modeId, not for the next event, since earlier events can still be in flight.
 */
async function postSentinels(): Promise<void> {
  for (const firm of FIRM_KEYS) {
    await setMode(firm, SENTINELS[firm]);
    await vi.waitFor(
      () => {
        for (const { received } of displays[firm]) {
          expect(received).toContainEqual([{ modeId: SENTINELS[firm] }]);
        }
      },
      { timeout: 2_000, interval: 10 },
    );
  }
}

describe('two firms with three displays each', () => {
  it("deliver every event to all of the firm's own displays, in order, and none to the other firm's", async () => {
    await Promise.all(FIRM_KEYS.map((firm) => postSequence(firm)));

    await postSentinels();

    for (const firm of FIRM_KEYS) {
      const expected = [...SEQUENCES[firm], SENTINELS[firm]].map((modeId) => [{ modeId }]);
      for (const { received } of displays[firm]) expect(received).toEqual(expected);
    }
  });

  it("get their own firm's mode from mode:get, and no event from it", async () => {
    const modes: Record<FirmKey, string> = { first: 'first-lobby', second: 'second-lobby' };
    await Promise.all(FIRM_KEYS.map((firm) => setMode(firm, modes[firm])));

    // All six at once, so the two firms' requests interleave on the server.
    const answers = await Promise.all(
      FIRM_KEYS.flatMap((firm) =>
        displays[firm].map(async ({ socket }) => ({ firm, answer: await requestMode(socket) })),
      ),
    );
    for (const { firm, answer } of answers) {
      expect(answer).toStrictEqual({ modeId: modes[firm] });
    }

    await postSentinels();

    for (const firm of FIRM_KEYS) {
      const expected = [modes[firm], SENTINELS[firm]].map((modeId) => [{ modeId }]);
      for (const { received } of displays[firm]) expect(received).toEqual(expected);
    }
  });
});

/** A display and a firm user's control screen on one connection, each recording what it gets. */
interface Pair {
  display: Socket;
  control: Socket;
  modes: unknown[][];
  signals: unknown[][];
}

function firmId(firm: FirmKey): string {
  const row = server.db
    .prepare<{ name: string }, { id: string }>('SELECT id FROM firms WHERE name = @name')
    .get({ name: FIRM_NAMES[firm] });
  if (!row) throw new Error(`No firm named ${FIRM_NAMES[firm]}`);
  return row.id;
}

/** Two pairs of one firm: the admin's control screen and a member's, each with its own display. */
async function connectPairs(firm: FirmKey): Promise<Pair[]> {
  insertUser(server.db, LATER, {
    firmId: firmId(firm),
    role: 'member',
    email: MEMBER_EMAILS[firm],
    passwordHash: 'unused',
  });
  const pairs: Pair[] = [];
  for (const email of [ADMIN_EMAILS[firm], MEMBER_EMAILS[firm]]) {
    const { display, control } = connectDisplayAndControl(
      server.url,
      { token: await issueDisplayToken(server, ADMIN_EMAILS[firm]) },
      { token: userTokenFor(server.db, email) },
    );
    pairs.push({
      display,
      control,
      modes: recordModeChanges(display),
      signals: recordModeChangedSignals(control),
    });
  }
  await Promise.all(
    pairs.flatMap(({ display, control }) => [connected(display), connected(control)]),
  );
  return pairs;
}

/**
 * Resolves with how many signals the pair's control screen had when its display got `modeId`.
 * `broadcastModeChange` emits to the displays before the control screens, so on the shared
 * connection every earlier signal has arrived by then, and this event's own signal has not.
 */
function signalsWhenDisplayGets({ display, signals }: Pair, modeId: string): Promise<number> {
  return new Promise((resolve) => {
    display.on('mode-change', (payload: { modeId: string }) => {
      if (payload.modeId === modeId) resolve(signals.length);
    });
  });
}

describe('two firms with control screens and displays on shared connections', () => {
  let pairs: Record<FirmKey, Pair[]>;

  beforeEach(async () => {
    pairs = { first: await connectPairs('first'), second: await connectPairs('second') };
  });

  it("signal every control screen of the firm once per event, and none of the other firm's", async () => {
    await Promise.all(FIRM_KEYS.map((firm) => postSequence(firm)));

    // Barrier per firm, after both sequences were answered: a signal leaked from either sequence
    // (or from the first firm's barrier) would be counted before the barrier event.
    for (const firm of FIRM_KEYS) {
      const counts = pairs[firm].map((pair) => signalsWhenDisplayGets(pair, SENTINELS[firm]));
      await setMode(firm, SENTINELS[firm]);
      expect(await Promise.all(counts)).toEqual([SEQUENCES[firm].length, SEQUENCES[firm].length]);
    }

    for (const firm of FIRM_KEYS) {
      const expected = [...SEQUENCES[firm], SENTINELS[firm]].map((modeId) => [{ modeId }]);
      for (const { modes } of pairs[firm]) expect(modes).toEqual(expected);
    }
  });
});
