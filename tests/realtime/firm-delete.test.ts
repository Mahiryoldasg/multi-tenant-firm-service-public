import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INVALID_DISPLAY_TOKEN_MESSAGE } from '../../src/server/realtime/display-auth.ts';
import { userTokenFor } from '../helpers/auth.ts';
import { TEST_SEED } from '../helpers/db.ts';
import {
  connectDisplay,
  connected,
  disconnected,
  issueDisplayToken,
  recordingDisplay,
  type RecordingDisplay,
  rejected,
  setModeAndAwait,
  startTestServer,
  stopTestServer,
  type TestServer,
} from '../helpers/realtime.ts';

const FIRST_ADMIN_EMAIL = TEST_SEED.firms[0].adminEmail;
const SECOND_ADMIN_EMAIL = TEST_SEED.firms[1].adminEmail;

let server: TestServer;
let firstFirmId: string;
let firstToken: string;
let first: RecordingDisplay;
let second: RecordingDisplay;

beforeEach(async () => {
  server = await startTestServer();
  firstFirmId = firmId('First Test Firm');
  const [firstIssued, secondIssued] = await Promise.all([
    issueDisplayToken(server, FIRST_ADMIN_EMAIL),
    issueDisplayToken(server, SECOND_ADMIN_EMAIL),
  ]);
  firstToken = firstIssued;
  first = recordingDisplay(server.url, firstIssued);
  second = recordingDisplay(server.url, secondIssued);
  await Promise.all([connected(first.socket), connected(second.socket)]);
});

afterEach(async () => {
  await stopTestServer(server);
});

function firmId(name: string): string {
  const row = server.db
    .prepare<{ name: string }, { id: string }>('SELECT id FROM firms WHERE name = @name')
    .get({ name });
  if (!row) throw new Error(`No firm named ${name}`);
  return row.id;
}

function deleteFirm(id: string) {
  return request(server.app)
    .delete(`/api/firms/${id}`)
    .set('Authorization', `Bearer ${userTokenFor(server.db, TEST_SEED.platformAdmin.email)}`);
}

describe('DELETE /api/firms/:id and the display channel', () => {
  it("drops the deleted firm's displays and keeps the other firm's", async () => {
    const dropped = disconnected(first.socket);

    const res = await deleteFirm(firstFirmId);

    expect(res.status).toBe(204);
    // The server tells the display it was dropped, so a Socket.IO client does not retry by itself.
    expect(await dropped).toBe('io server disconnect');
    expect(first.socket.connected).toBe(false);

    await setModeAndAwait(server, SECOND_ADMIN_EMAIL, 'still-here', second);
    expect(second.socket.connected).toBe(true);
    expect(second.received).toEqual([[{ modeId: 'still-here' }]]);
  });

  it("rejects the deleted firm's display token when it connects again", async () => {
    const dropped = disconnected(first.socket);
    expect((await deleteFirm(firstFirmId)).status).toBe(204);
    await dropped;

    const error = await rejected(connectDisplay(server.url, { token: firstToken }));

    expect(error.message).toBe(INVALID_DISPLAY_TOKEN_MESSAGE);
  });

  it('disconnects nothing when the delete answers 404', async () => {
    expect((await deleteFirm(randomUUID())).status).toBe(404);

    await setModeAndAwait(server, FIRST_ADMIN_EMAIL, 'first-still-here', first);
    await setModeAndAwait(server, SECOND_ADMIN_EMAIL, 'second-still-here', second);

    expect(first.socket.connected).toBe(true);
    expect(second.socket.connected).toBe(true);
    expect(first.received).toEqual([[{ modeId: 'first-still-here' }]]);
    expect(second.received).toEqual([[{ modeId: 'second-still-here' }]]);
  });
});
