import type Database from 'better-sqlite3';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/app.ts';
import { TEST_SEED } from '../helpers/db.ts';
import { setUpTwoFirms, type TwoFirms } from '../helpers/two-firms.ts';

// Contract §3: with several faults in one request, the first of 401 → 403 → 404 → 400 → 409 wins.
// Each rung of a ladder below also carries every fault of the rungs after it. Every caller with a
// firm is from the first firm; "another firm's id" is the second firm's member.

const FIRMS_PATH = '/api/firms';
const EMPLOYEES_PATH = '/api/employees';
const MODE_PATH = '/api/mode';
const DISPLAY_TOKENS_PATH = '/api/display-tokens';

const UNKNOWN_ID = randomUUID();
// Active emails in another casing: a clash for firm create (first firm's admin) and for employees
// (the second firm's admin, so the clash is across firms).
const TAKEN_FIRM_ADMIN_EMAIL = TEST_SEED.firms[0].adminEmail.toUpperCase();
const TAKEN_EMPLOYEE_EMAIL = TEST_SEED.firms[1].adminEmail.toUpperCase();

const INVALID_FIRM_BODY = { name: '   ', adminEmail: TAKEN_FIRM_ADMIN_EMAIL, adminPassword: '' };
const INVALID_EMPLOYEE_BODY = { email: TAKEN_EMPLOYEE_EMAIL, role: 'platform_admin' };

const CODES = {
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  400: 'VALIDATION_ERROR',
  409: 'CONFLICT',
} as const;

type Status = keyof typeof CODES;
type Method = 'get' | 'post' | 'patch' | 'delete';
type Caller = 'none' | 'display' | 'platformAdmin' | 'firmAdmin' | 'member';

const CALLER_LABELS: Record<Caller, string> = {
  none: 'no token',
  display: 'a display token',
  platformAdmin: 'the platform admin',
  firmAdmin: 'a firm admin',
  member: 'a member',
};

interface Rung {
  label: string;
  caller: Caller;
  path: (firms: TwoFirms) => string;
  body: object | undefined;
  status: Status;
}

interface Ladder {
  method: Method;
  route: string;
  rungs: Rung[];
}

/** One rung per caller, all sending the same request with the same faults. */
function rungs(
  status: Status,
  callers: Caller[],
  faults: string,
  path: (firms: TwoFirms) => string,
  body?: object,
): Rung[] {
  return callers.map((caller) => ({
    label: `${CALLER_LABELS[caller]} with ${faults} gets ${status} ${CODES[status]}`,
    caller,
    path,
    body,
    status,
  }));
}

const UNAUTHENTICATED: Caller[] = ['none', 'display'];

const unknownFirm = () => `${FIRMS_PATH}/${UNKNOWN_ID}`;
const ownFirm = (firms: TwoFirms) => `${FIRMS_PATH}/${firms.first.firmId}`;
const otherEmployee = (firms: TwoFirms) => `${EMPLOYEES_PATH}/${firms.second.member.id}`;
const ownMember = (firms: TwoFirms) => `${EMPLOYEES_PATH}/${firms.first.member.id}`;
const fixed = (path: string) => () => path;

const LADDERS: Ladder[] = [
  {
    method: 'post',
    route: FIRMS_PATH,
    rungs: [
      ...rungs(
        401,
        UNAUTHENTICATED,
        'an invalid body and a taken email',
        fixed(FIRMS_PATH),
        INVALID_FIRM_BODY,
      ),
      ...rungs(
        403,
        ['firmAdmin', 'member'],
        'an invalid body and a taken email',
        fixed(FIRMS_PATH),
        INVALID_FIRM_BODY,
      ),
      ...rungs(
        400,
        ['platformAdmin'],
        'an invalid body and a taken email',
        fixed(FIRMS_PATH),
        INVALID_FIRM_BODY,
      ),
      ...rungs(409, ['platformAdmin'], 'a valid body and a taken email', fixed(FIRMS_PATH), {
        name: 'New Firm',
        adminEmail: TAKEN_FIRM_ADMIN_EMAIL,
        adminPassword: 'new-secret',
      }),
    ],
  },
  {
    method: 'patch',
    route: `${FIRMS_PATH}/:id`,
    rungs: [
      ...rungs(401, UNAUTHENTICATED, 'an unknown id and an empty body', unknownFirm, {}),
      ...rungs(403, ['firmAdmin', 'member'], 'an unknown id and an empty body', unknownFirm, {}),
      ...rungs(404, ['platformAdmin'], 'an unknown id and an empty body', unknownFirm, {}),
      ...rungs(400, ['platformAdmin'], "a live firm's id and an empty body", ownFirm, {}),
    ],
  },
  {
    method: 'delete',
    route: `${FIRMS_PATH}/:id`,
    rungs: [
      ...rungs(401, UNAUTHENTICATED, 'an unknown id', unknownFirm),
      ...rungs(403, ['firmAdmin', 'member'], 'an unknown id', unknownFirm),
      ...rungs(404, ['platformAdmin'], 'an unknown id', unknownFirm),
    ],
  },
  {
    method: 'get',
    route: EMPLOYEES_PATH,
    rungs: [
      ...rungs(401, UNAUTHENTICATED, 'nothing else wrong', fixed(EMPLOYEES_PATH)),
      ...rungs(403, ['platformAdmin'], 'nothing else wrong', fixed(EMPLOYEES_PATH)),
    ],
  },
  {
    method: 'get',
    route: `${EMPLOYEES_PATH}/:id`,
    rungs: [
      ...rungs(401, UNAUTHENTICATED, "another firm's id", otherEmployee),
      ...rungs(403, ['platformAdmin'], "another firm's id", otherEmployee),
      ...rungs(404, ['firmAdmin', 'member'], "another firm's id", otherEmployee),
    ],
  },
  {
    method: 'post',
    route: EMPLOYEES_PATH,
    rungs: [
      ...rungs(
        401,
        UNAUTHENTICATED,
        'an invalid body and a taken email',
        fixed(EMPLOYEES_PATH),
        INVALID_EMPLOYEE_BODY,
      ),
      ...rungs(
        403,
        ['platformAdmin'],
        'an invalid body and a taken email',
        fixed(EMPLOYEES_PATH),
        INVALID_EMPLOYEE_BODY,
      ),
      ...rungs(
        403,
        ['member'],
        'an invalid body and a taken email (contract §3 example)',
        fixed(EMPLOYEES_PATH),
        INVALID_EMPLOYEE_BODY,
      ),
      ...rungs(
        400,
        ['firmAdmin'],
        'an invalid body and a taken email',
        fixed(EMPLOYEES_PATH),
        INVALID_EMPLOYEE_BODY,
      ),
      ...rungs(409, ['firmAdmin'], 'a valid body and a taken email', fixed(EMPLOYEES_PATH), {
        email: TAKEN_EMPLOYEE_EMAIL,
        password: 'new-secret',
        role: 'member',
      }),
    ],
  },
  {
    method: 'patch',
    route: `${EMPLOYEES_PATH}/:id`,
    rungs: [
      ...rungs(
        401,
        UNAUTHENTICATED,
        "another firm's id, an invalid body and a taken email",
        otherEmployee,
        INVALID_EMPLOYEE_BODY,
      ),
      ...rungs(
        403,
        ['platformAdmin', 'member'],
        "another firm's id, an invalid body and a taken email",
        otherEmployee,
        INVALID_EMPLOYEE_BODY,
      ),
      ...rungs(
        404,
        ['firmAdmin'],
        "another firm's id and an empty body (contract §3 example)",
        otherEmployee,
        {},
      ),
      ...rungs(
        404,
        ['firmAdmin'],
        "another firm's id, an invalid body and a taken email",
        otherEmployee,
        INVALID_EMPLOYEE_BODY,
      ),
      ...rungs(
        400,
        ['firmAdmin'],
        'its own member, an invalid body and a taken email',
        ownMember,
        INVALID_EMPLOYEE_BODY,
      ),
      ...rungs(409, ['firmAdmin'], 'its own member and a taken email', ownMember, {
        email: TAKEN_EMPLOYEE_EMAIL,
      }),
    ],
  },
  {
    method: 'delete',
    route: `${EMPLOYEES_PATH}/:id`,
    rungs: [
      ...rungs(401, UNAUTHENTICATED, "another firm's id", otherEmployee),
      ...rungs(403, ['platformAdmin', 'member'], "another firm's id", otherEmployee),
      ...rungs(404, ['firmAdmin'], "another firm's id", otherEmployee),
    ],
  },
  {
    method: 'get',
    route: MODE_PATH,
    rungs: [
      ...rungs(401, UNAUTHENTICATED, 'nothing else wrong', fixed(MODE_PATH)),
      ...rungs(403, ['platformAdmin'], 'nothing else wrong', fixed(MODE_PATH)),
    ],
  },
  {
    method: 'post',
    route: MODE_PATH,
    rungs: [
      ...rungs(401, UNAUTHENTICATED, 'an empty body', fixed(MODE_PATH), {}),
      ...rungs(403, ['platformAdmin', 'member'], 'an empty body', fixed(MODE_PATH), {}),
      ...rungs(400, ['firmAdmin'], 'an empty body', fixed(MODE_PATH), {}),
      ...rungs(400, ['firmAdmin'], 'a blank modeId', fixed(MODE_PATH), { modeId: '   ' }),
    ],
  },
  {
    method: 'post',
    route: DISPLAY_TOKENS_PATH,
    rungs: [
      ...rungs(401, UNAUTHENTICATED, 'a non-string label', fixed(DISPLAY_TOKENS_PATH), {
        label: 42,
      }),
      ...rungs(403, ['platformAdmin', 'member'], 'a non-string label', fixed(DISPLAY_TOKENS_PATH), {
        label: 42,
      }),
      ...rungs(400, ['firmAdmin'], 'a non-string label', fixed(DISPLAY_TOKENS_PATH), {
        label: 42,
      }),
    ],
  },
  {
    method: 'get',
    route: '/api/nope',
    rungs: [
      ...rungs(401, UNAUTHENTICATED, 'an unknown path', fixed('/api/nope')),
      ...rungs(404, ['firmAdmin'], 'an unknown path', fixed('/api/nope')),
    ],
  },
];

let app: Express;
let db: Database.Database;
let firms: TwoFirms;
let displayToken: string;

beforeEach(async () => {
  ({ app, db } = await createTestApp());
  firms = await setUpTwoFirms({ app, db });
  const res = await request(app)
    .post(DISPLAY_TOKENS_PATH)
    .set('Authorization', `Bearer ${firms.first.admin.token}`)
    .send({});
  expect(res.status).toBe(201);
  displayToken = (res.body as { token: string }).token;
});

afterEach(() => {
  if (db.open) db.close();
});

function tokenOf(caller: Caller): string | undefined {
  switch (caller) {
    case 'none':
      return undefined;
    case 'display':
      return displayToken;
    case 'platformAdmin':
      return firms.platformAdminToken;
    case 'firmAdmin':
      return firms.first.admin.token;
    case 'member':
      return firms.first.member.token;
  }
}

// Plain loops rather than `each`: Vitest quotes `$label` titles and cuts them at 40 characters,
// which would hide the expected status.
for (const { method, route, rungs: ladder } of LADDERS) {
  describe(`${method.toUpperCase()} ${route}`, () => {
    for (const { label, caller, path, body, status } of ladder) {
      it(label, async () => {
        let req = request(app)[method](path(firms));
        const token = tokenOf(caller);
        if (token !== undefined) req = req.set('Authorization', `Bearer ${token}`);

        const res = await (body === undefined ? req : req.send(body));

        expect(res.status).toBe(status);
        expect(res.body).toEqual({ error: { code: CODES[status], message: expect.any(String) } });
      });
    }
  });
}
