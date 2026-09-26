import { ESLint } from 'eslint';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// Lints probe code under virtual file paths with the real eslint.config.js; the files never exist.
const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

// Each probe file with its relative way up to src/server and over to modules/platform.
const TENANT_FILES = [
  { file: 'src/server/modules/tenant/probe.ts', server: '../../', platform: '../platform/' },
  {
    file: 'src/server/modules/tenant/nested/probe.ts',
    server: '../../../',
    platform: '../../platform/',
  },
];

type Probe = (paths: { server: string; platform: string }) => string;

const FORBIDDEN: Probe[] = [
  () => "import Database from 'better-sqlite3';",
  () => "import type Database from 'better-sqlite3';",
  ({ server }) => `import { openDatabase } from '${server}db/connection.ts';`,
  ({ server }) => `import { seedDatabase } from '${server}db/seed.ts';`,
  ({ platform }) => `import { findActiveUserById } from '${platform}users.ts';`,
  ({ platform }) => `import { listActiveFirms } from '${platform}firms.ts';`,
  ({ server }) => `import { insertUser } from '${server}modules/platform/users.ts';`,
  ({ platform }) => `export { listActiveFirms } from '${platform}firms.ts';`,
];

const ALLOWED: Probe[] = [
  ({ server }) => `import { HttpError } from '${server}http/errors.ts';`,
  ({ server }) => `import { getTenant } from '${server}http/tenant.ts';`,
  ({ server }) => `import { isValidEmail } from '${server}auth/email.ts';`,
  ({ server }) => `import type { TenantScope } from '${server}tenancy/scope.ts';`,
  () => "import { z } from 'zod';",
  () => "import { Router } from 'express';",
];

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: REPO_ROOT });
});

/** The boundary rule's messages for `code` linted as `file`; other rules (unused imports) are ignored. */
async function boundaryMessages(code: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(`${code}\n`, { filePath: path.join(REPO_ROOT, file) });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === 'no-restricted-imports')
    .map((message) => message.message);
}

describe('the tenancy boundary rule', () => {
  it.each(
    TENANT_FILES.flatMap((paths) =>
      FORBIDDEN.map((probe) => ({ file: paths.file, code: probe(paths) })),
    ),
  )('reports $code in $file', async ({ code, file }) => {
    expect(await boundaryMessages(code, file)).toEqual([expect.stringContaining('req.tenant')]);
  });

  it.each(
    TENANT_FILES.flatMap((paths) =>
      ALLOWED.map((probe) => ({ file: paths.file, code: probe(paths) })),
    ),
  )('allows $code in $file', async ({ code, file }) => {
    expect(await boundaryMessages(code, file)).toEqual([]);
  });

  it.each([
    { file: 'src/server/tenancy/probe.ts', code: "import Database from 'better-sqlite3';" },
    {
      file: 'src/server/tenancy/probe.ts',
      code: "import { openDatabase } from '../db/connection.ts';",
    },
    {
      file: 'src/server/modules/platform/probe.ts',
      code: "import Database from 'better-sqlite3';",
    },
    {
      file: 'src/server/modules/platform/probe.ts',
      code: "import { openDatabase } from '../../db/connection.ts';",
    },
  ])('does not apply outside the tenant module: $code in $file', async ({ code, file }) => {
    expect(await boundaryMessages(code, file)).toEqual([]);
  });
});
