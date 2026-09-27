import type Database from 'better-sqlite3';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/app.ts';
import { type Actor, setUpTwoFirms, type TwoFirms } from '../helpers/two-firms.ts';

const EMPLOYEES_PATH = '/api/employees';

const FORBIDDEN = { error: { code: 'FORBIDDEN', message: expect.any(String) } };
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: expect.any(String) } };

// Every table a tenant request could write to. A denied request must leave all of them unchanged.
const SNAPSHOT_QUERIES = [
  'SELECT * FROM firms ORDER BY id',
  'SELECT * FROM users ORDER BY id',
  'SELECT * FROM display_tokens ORDER BY id',
];

type FirmKey = 'first' | 'second';
type Method = 'get' | 'patch' | 'delete';

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

const DIRECTIONS: { from: FirmKey; to: FirmKey }[] = [
  { from: 'first', to: 'second' },
  { from: 'second', to: 'first' },
];
const CALLER_ROLES = ['admin', 'member'] as const;
const TARGETS = ['admin', 'member'] as const;

// Every request on an employee id. The PATCH bodies go from valid to empty to a taken email, so a
// cross-tenant 404 must win over any 400 or 409 the body would earn on the caller's own firm.
const ID_REQUESTS: {
  action: string;
  method: Method;
  write: boolean;
  body?: (caller: Actor) => object;
}[] = [
  { action: 'GETting', method: 'get', write: false },
  {
    action: 'PATCHing with a valid body',
    method: 'patch',
    write: true,
    body: () => ({ role: 'member' }),
  },
  { action: 'PATCHing with an empty body', method: 'patch', write: true, body: () => ({}) },
  {
    action: 'PATCHing with a taken email',
    method: 'patch',
    write: true,
    body: (caller) => ({ email: caller.email }),
  },
  { action: 'DELETEing', method: 'delete', write: true },
];

const ID_MATRIX = DIRECTIONS.flatMap(({ from, to }) =>
  CALLER_ROLES.flatMap((role) =>
    TARGETS.flatMap((target) =>
      ID_REQUESTS.map((idRequest) => {
        // A member's write fails on the role first (403); anything else is simply not found.
        const status = idRequest.write && role === 'member' ? 403 : 404;
        return {
          label: `the ${from} firm's ${role} ${idRequest.action} the ${to} firm's ${target} gets ${status}`,
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

describe("another firm's employee ids", () => {
  it.each(ID_MATRIX)('$label and changes nothing', async (row) => {
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
});

describe('a 404 that leaks nothing', () => {
  it.each([
    { label: 'GET', method: 'get' as const, body: undefined },
    { label: 'PATCH', method: 'patch' as const, body: { role: 'member' } },
    { label: 'DELETE', method: 'delete' as const, body: undefined },
  ])(
    "answers $label for another firm's, an unknown and a deleted id with the same body",
    async ({ method, body }) => {
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
    },
  );
});
