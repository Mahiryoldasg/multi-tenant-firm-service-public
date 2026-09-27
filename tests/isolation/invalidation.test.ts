import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  connectDisplay,
  connected,
  disconnected,
  issueDisplayToken,
  recordingDisplay,
  rejected,
  setModeAndAwait,
  startTestServer,
  stopTestServer,
  type TestServer,
} from '../helpers/realtime.ts';
import { type Actor, setUpTwoFirms, type TwoFirms } from '../helpers/two-firms.ts';

// Contract §2: what a deletion or a role change does to tokens that were issued before it.

const EMPLOYEES_PATH = '/api/employees';
const MODE_PATH = '/api/mode';
const DISPLAY_TOKENS_PATH = '/api/display-tokens';
// One read per kind of route a firm user reaches: the session itself, employees and the mode.
const SESSION_READS = ['/api/auth/me', EMPLOYEES_PATH, MODE_PATH];

let server: TestServer;
let firms: TwoFirms;

beforeEach(async () => {
  server = await startTestServer();
  firms = await setUpTwoFirms(server);
});

afterEach(async () => {
  await stopTestServer(server);
});

function send(method: 'get' | 'post' | 'patch' | 'delete', path: string, token: string) {
  return request(server.app)[method](path).set('Authorization', `Bearer ${token}`);
}

/** The status of each session read with this token, in `SESSION_READS` order. */
async function readStatuses(token: string): Promise<number[]> {
  const statuses: number[] = [];
  for (const path of SESSION_READS) statuses.push((await send('get', path, token)).status);
  return statuses;
}

async function loginStatus({ email, password }: Actor): Promise<number> {
  return (await request(server.app).post('/api/auth/login').send({ email, password })).status;
}

async function setRole(admin: Actor, employee: Actor, role: 'firm_admin' | 'member') {
  const res = await send('patch', `${EMPLOYEES_PATH}/${employee.id}`, admin.token).send({ role });
  expect(res.status).toBe(200);
}

async function deleteEmployee(admin: Actor, employee: Actor) {
  const res = await send('delete', `${EMPLOYEES_PATH}/${employee.id}`, admin.token);
  expect(res.status).toBe(204);
}

describe('a deleted employee', () => {
  it('loses their earlier token and their login, and nobody else is affected', async () => {
    const { first, second } = firms;

    await deleteEmployee(first.admin, first.member);

    expect(await readStatuses(first.member.token)).toEqual([401, 401, 401]);
    expect(await loginStatus(first.member)).toBe(401);
    expect(await readStatuses(first.admin.token)).toEqual([200, 200, 200]);
    expect(await readStatuses(second.member.token)).toEqual([200, 200, 200]);
  });
});

describe('a deleted firm', () => {
  it('invalidates all its users and displays, and leaves the other firm working', async () => {
    const { first, second } = firms;
    const firstDisplayToken = await issueDisplayToken(server, first.admin.email);
    const firstDisplay = connectDisplay(server.url, { token: firstDisplayToken });
    const secondDisplay = recordingDisplay(
      server.url,
      await issueDisplayToken(server, second.admin.email),
    );
    await Promise.all([connected(firstDisplay), connected(secondDisplay.socket)]);
    const dropped = disconnected(firstDisplay);

    const res = await send('delete', `/api/firms/${first.firmId}`, firms.platformAdminToken);
    expect(res.status).toBe(204);

    for (const user of [first.admin, first.member]) {
      expect(await readStatuses(user.token)).toEqual([401, 401, 401]);
      expect((await send('post', DISPLAY_TOKENS_PATH, user.token).send({})).status).toBe(401);
      expect(await loginStatus(user)).toBe(401);
    }
    expect(await dropped).toBe('io server disconnect');
    await rejected(connectDisplay(server.url, { token: firstDisplayToken }));

    expect(await readStatuses(second.admin.token)).toEqual([200, 200, 200]);
    expect(await loginStatus(second.admin)).toBe(200);
    await setModeAndAwait(server, second.admin.email, 'after-delete', secondDisplay);
    expect(secondDisplay.received).toEqual([[{ modeId: 'after-delete' }]]);
  });
});

describe('a role change', () => {
  it("applies to the user's earlier token on the next request, both ways", async () => {
    const { admin, member } = firms.first;
    // Minted before any change, and used unchanged throughout.
    const earlierToken = member.token;

    await setRole(admin, member, 'firm_admin');
    const promoted = await send('post', MODE_PATH, earlierToken).send({ modeId: 'promoted' });
    expect(promoted.status).toBe(200);

    await setRole(admin, member, 'member');
    const demoted = await send('post', MODE_PATH, earlierToken).send({ modeId: 'demoted' });
    expect(demoted.status).toBe(403);
    expect(demoted.body).toEqual({ error: { code: 'FORBIDDEN', message: expect.any(String) } });
    expect((await send('get', MODE_PATH, earlierToken)).status).toBe(200);
  });
});

describe("a display token's creator", () => {
  it('can be demoted and then deleted without affecting the display token', async () => {
    const { admin, member } = firms.first;
    await setRole(admin, member, 'firm_admin');
    const issued = await send('post', DISPLAY_TOKENS_PATH, member.token).send({ label: 'lobby' });
    expect(issued.status).toBe(201);
    const displayToken = (issued.body as { token: string }).token;

    await setRole(admin, member, 'member');
    const afterDemotion = recordingDisplay(server.url, displayToken);
    await connected(afterDemotion.socket);
    await setModeAndAwait(server, admin.email, 'after-demotion', afterDemotion);
    expect(afterDemotion.received).toEqual([[{ modeId: 'after-demotion' }]]);

    await deleteEmployee(admin, member);
    expect(await readStatuses(member.token)).toEqual([401, 401, 401]);
    const afterDeletion = recordingDisplay(server.url, displayToken);
    await connected(afterDeletion.socket);
    await setModeAndAwait(server, admin.email, 'after-deletion', afterDeletion);
    expect(afterDeletion.received).toEqual([[{ modeId: 'after-deletion' }]]);
  });
});
