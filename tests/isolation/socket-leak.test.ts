import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userTokenFor } from '../helpers/auth.ts';
import { TEST_SEED } from '../helpers/db.ts';
import {
  connected,
  issueDisplayToken,
  recordingDisplay,
  type RecordingDisplay,
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

describe('two firms with three displays each', () => {
  it("deliver every event to all of the firm's own displays, in order, and none to the other firm's", async () => {
    await Promise.all(FIRM_KEYS.map((firm) => postSequence(firm)));

    // Barrier: each firm's own final event, posted after both sequences were answered. Socket.IO
    // keeps order per connection, so an event of either sequence that reached a display at all
    // arrived before this one. It waits for this modeId, not for the next event, since sequence
    // events can still be in flight.
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

    for (const firm of FIRM_KEYS) {
      const expected = [...SEQUENCES[firm], SENTINELS[firm]].map((modeId) => [{ modeId }]);
      for (const { received } of displays[firm]) expect(received).toEqual(expected);
    }
  });
});
