import type Database from 'better-sqlite3';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyToken } from '../../src/server/auth/tokens.ts';
import { createTestApp, TEST_CONFIG } from '../helpers/app.ts';
import { TEST_SEED } from '../helpers/db.ts';
import { type Actor, setUpTwoFirms, type TwoFirms } from '../helpers/two-firms.ts';

const EMPLOYEES_PATH = '/api/employees';
const MODE_PATH = '/api/mode';
const DISPLAY_TOKENS_PATH = '/api/display-tokens';
const FIRMS_PATH = '/api/firms';

const FORBIDDEN = { error: { code: 'FORBIDDEN', message: expect.any(String) } };
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: expect.any(String) } };

// Every table a tenant request could write to. A denied request must leave all of them unchanged.
const SNAPSHOT_QUERIES = [
  'SELECT * FROM firms ORDER BY id',
  'SELECT * FROM users ORDER BY id',
  'SELECT * FROM display_tokens ORDER BY id',
];

type FirmKey = 'first' | 'second';
type Method = 'get' | 'post' | 'patch' | 'delete';

const SEED_FIRM_NAMES: Record<FirmKey, string> = {
  first: TEST_SEED.firms[0].name,
  second: TEST_SEED.firms[1].name,
};

let app: Express;
let db: Database.Database;
let firms: TwoFirms;

beforeEach(async () => {
  ({ app, db } = await createTestApp());
  firms = await setUpTwoFirms({ app, db });
});

afterEach(() => {
  if (db.open) db.close();
});

function snapshot(): unknown[][] {
  return SNAPSHOT_QUERIES.map((sql) => db.prepare(sql).all());
}

function send(method: Method, path: string, token: string, body?: object) {
  const req = request(app)[method](path).set('Authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
}

async function listedIds(token: string, query = ''): Promise<string[]> {
  const res = await send('get', `${EMPLOYEES_PATH}${query}`, token);
  expect(res.status).toBe(200);
  return (res.body as { employees: { id: string }[] }).employees.map(({ id }) => id);
}

async function modeOf(token: string, query = ''): Promise<unknown> {
  const res = await send('get', `${MODE_PATH}${query}`, token);
  expect(res.status).toBe(200);
  return res.body;
}

const DIRECTIONS: { from: FirmKey; to: FirmKey }[] = [
  { from: 'first', to: 'second' },
  { from: 'second', to: 'first' },
];
const CALLER_ROLES = ['admin', 'member'] as const;
const TARGETS = ['admin', 'member'] as const;

// Every request on an employee id. The PATCH bodies go from valid to empty to a taken email, so a
// cross-tenant 404 must win over any 400 or 409 the body would earn on the caller's own firm.
const ID_REQUESTS: {
  verb: string;
  detail: string;
  method: Method;
  write: boolean;
  body?: (caller: Actor) => object;
}[] = [
  { verb: 'GETting', detail: '', method: 'get', write: false },
  {
    verb: 'PATCHing',
    detail: ' with a valid body',
    method: 'patch',
    write: true,
    body: () => ({ role: 'member' }),
  },
  {
    verb: 'PATCHing',
    detail: ' with an empty body',
    method: 'patch',
    write: true,
    body: () => ({}),
  },
  {
    verb: 'PATCHing',
    detail: ' with a taken email',
    method: 'patch',
    write: true,
    body: (caller) => ({ email: caller.email }),
  },
  { verb: 'DELETEing', detail: '', method: 'delete', write: true },
];

const ID_MATRIX = DIRECTIONS.flatMap(({ from, to }) =>
  CALLER_ROLES.flatMap((role) =>
    TARGETS.flatMap((target) =>
      ID_REQUESTS.map((idRequest) => {
        // A member's write fails on the role first (403); anything else is simply not found.
        const status = idRequest.write && role === 'member' ? 403 : 404;
        return {
          label: `the ${from} firm's ${role} ${idRequest.verb} the ${to} firm's ${target}${idRequest.detail} gets ${status}`,
          from,
          to,
          role,
          target,
          idRequest,
          status,
        };
      }),
    ),
  ),
);

// Plain loops rather than `each` throughout: Vitest quotes `$label` titles and cuts them at 40
// characters, which would hide the expected status.
describe("another firm's employee ids", () => {
  for (const row of ID_MATRIX) {
    it(`${row.label} and changes nothing`, async () => {
      const caller = firms[row.from][row.role];
      const targetId = firms[row.to][row.target].id;
      const before = snapshot();

      const res = await send(
        row.idRequest.method,
        `${EMPLOYEES_PATH}/${targetId}`,
        caller.token,
        row.idRequest.body?.(caller),
      );

      expect(res.status).toBe(row.status);
      expect(res.body).toEqual(row.status === 403 ? FORBIDDEN : NOT_FOUND);
      expect(snapshot()).toEqual(before);
    });
  }
});

describe('a 404 that leaks nothing', () => {
  const requests: { method: Method; body?: object }[] = [
    { method: 'get' },
    { method: 'patch', body: { role: 'member' } },
    { method: 'delete' },
  ];

  for (const { method, body } of requests) {
    it(`answers ${method.toUpperCase()} for another firm's, an unknown and a deleted id with the same body`, async () => {
      const { first, second } = firms;
      const deleted = await send(
        'delete',
        `${EMPLOYEES_PATH}/${first.member.id}`,
        first.admin.token,
      );
      expect(deleted.status).toBe(204);

      const sendTo = (id: string) =>
        send(method, `${EMPLOYEES_PATH}/${id}`, first.admin.token, body);
      const foreign = await sendTo(second.member.id);
      const unknown = await sendTo(randomUUID());
      const softDeleted = await sendTo(first.member.id);

      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual(NOT_FOUND);
      // The message is the behavior here: identical bytes, so the body tells nothing apart.
      expect(unknown.status).toBe(404);
      expect(unknown.text).toBe(foreign.text);
      expect(softDeleted.status).toBe(404);
      expect(softDeleted.text).toBe(foreign.text);
    });
  }
});

// Reads with and without another firm's id in the query string: nothing but the token picks a firm.
const READERS = DIRECTIONS.flatMap(({ from, to }) =>
  CALLER_ROLES.flatMap((role) =>
    [false, true].map((withQuery) => ({
      label: `the ${from} firm's ${role}${withQuery ? ` sending ?firmId of the ${to} firm` : ''}`,
      from,
      to,
      role,
      withQuery,
    })),
  ),
);

describe("another firm's id in the query or body", () => {
  function query({ to, withQuery }: { to: FirmKey; withQuery: boolean }): string {
    return withQuery ? `?firmId=${firms[to].firmId}` : '';
  }

  for (const row of READERS) {
    it(`${row.label} lists only its own firm's employees`, async () => {
      const own = firms[row.from];

      expect(await listedIds(own[row.role].token, query(row))).toEqual([
        own.admin.id,
        own.member.id,
      ]);
    });

    it(`${row.label} reads only its own firm's mode`, async () => {
      const other = firms[row.to];
      const set = await send('post', MODE_PATH, other.admin.token, { modeId: `${row.to}-mode` });
      expect(set.status).toBe(200);

      expect(await modeOf(firms[row.from][row.role].token, query(row))).toEqual({ modeId: null });
    });
  }

  for (const { from, to } of DIRECTIONS) {
    const caller = `the ${from} firm's admin`;
    const smuggled = `the ${to} firm's firmId`;

    it(`${caller} setting the mode with ${smuggled} changes only its own firm`, async () => {
      const own = firms[from];
      const other = firms[to];

      const res = await send('post', MODE_PATH, own.admin.token, {
        modeId: 'smuggled',
        firmId: other.firmId,
      });

      expect(res.status).toBe(200);
      expect(await modeOf(own.admin.token)).toEqual({ modeId: 'smuggled' });
      expect(await modeOf(other.admin.token)).toEqual({ modeId: null });
    });

    it(`${caller} creating an employee with ${smuggled} creates it in its own firm`, async () => {
      const own = firms[from];
      const other = firms[to];

      const res = await send('post', EMPLOYEES_PATH, own.admin.token, {
        email: 'Smuggled@Employee.Test',
        password: 'smuggled-secret',
        role: 'member',
        firmId: other.firmId,
      });

      expect(res.status).toBe(201);
      const { id } = (res.body as { employee: { id: string } }).employee;
      expect(await listedIds(own.admin.token)).toContain(id);
      expect(await listedIds(other.admin.token)).not.toContain(id);
    });

    it(`${caller} updating its member with ${smuggled} keeps them in its own firm`, async () => {
      const own = firms[from];
      const other = firms[to];

      const res = await send('patch', `${EMPLOYEES_PATH}/${own.member.id}`, own.admin.token, {
        role: 'firm_admin',
        firmId: other.firmId,
      });

      expect(res.status).toBe(200);
      expect(await listedIds(own.admin.token)).toContain(own.member.id);
      expect(await listedIds(other.admin.token)).not.toContain(own.member.id);
    });

    it(`${caller} issuing a display token with ${smuggled} gets one for its own firm`, async () => {
      const own = firms[from];

      const res = await send('post', DISPLAY_TOKENS_PATH, own.admin.token, {
        label: 'lobby',
        firmId: firms[to].firmId,
      });

      expect(res.status).toBe(201);
      const claims = verifyToken((res.body as { token: string }).token, TEST_CONFIG.jwtSecret);
      expect(claims).toMatchObject({ kind: 'display', firmId: own.firmId });
    });
  }
});

describe('token claims', () => {
  it("never pick the firm or the role: the user's firm and role come from the DB", async () => {
    const { first, second } = firms;
    // Validly signed, but claiming the second firm and the platform admin role for the first
    // firm's admin.
    const token = jwt.sign(
      { sub: first.admin.id, role: 'platform_admin', firmId: second.firmId },
      TEST_CONFIG.jwtSecret,
      { algorithm: 'HS256' },
    );

    expect(await listedIds(token)).toEqual([first.admin.id, first.member.id]);
    const foreign = await send('get', `${EMPLOYEES_PATH}/${second.admin.id}`, token);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(NOT_FOUND);
    const firmList = await send('get', FIRMS_PATH, token);
    expect(firmList.status).toBe(403);
    expect(firmList.body).toEqual(FORBIDDEN);
  });
});

const FIRM_WRITES = DIRECTIONS.flatMap(({ from, to }) =>
  CALLER_ROLES.flatMap((role) => [
    {
      label: `the ${from} firm's ${role} renaming the ${to} firm`,
      method: 'patch' as const,
      body: { name: 'Taken Over' },
      from,
      to,
      role,
    },
    {
      label: `the ${from} firm's ${role} deleting the ${to} firm`,
      method: 'delete' as const,
      body: undefined,
      from,
      to,
      role,
    },
  ]),
);

describe("another firm's firm routes", () => {
  for (const row of FIRM_WRITES) {
    it(`${row.label} gets 403 and changes nothing`, async () => {
      const target = firms[row.to];
      const before = snapshot();

      const res = await send(
        row.method,
        `${FIRMS_PATH}/${target.firmId}`,
        firms[row.from][row.role].token,
        row.body,
      );

      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
      expect(snapshot()).toEqual(before);
      const listed = await send('get', FIRMS_PATH, firms.platformAdminToken);
      expect((listed.body as { firms: unknown[] }).firms).toContainEqual(
        expect.objectContaining({ id: target.firmId, name: SEED_FIRM_NAMES[row.to] }),
      );
    });
  }
});
