import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = new URL('../../scripts/ensure-env.mjs', import.meta.url);
const EXAMPLE = 'PORT=4000\nJWT_SECRET=\nDB_PATH=./data/app.db\n';
const GENERATED_SECRET = /^[A-Za-z0-9_-]{64}$/;

let dir: string;

// The script finds .env and .env.example next to its own folder, so a copy in a temp dir never
// touches the repository's .env.
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ensure-env-'));
  mkdirSync(path.join(dir, 'scripts'));
  copyFileSync(SCRIPT, path.join(dir, 'scripts', 'ensure-env.mjs'));
  writeFileSync(path.join(dir, '.env.example'), EXAMPLE);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function runEnsureEnv(): string {
  const result = spawnSync(process.execPath, [path.join(dir, 'scripts', 'ensure-env.mjs')], {
    cwd: dir,
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

function writeEnv(content: string): void {
  writeFileSync(path.join(dir, '.env'), content);
}

function readEnv(): string {
  return readFileSync(path.join(dir, '.env'), 'utf8');
}

function secretIn(content: string): string {
  return /^JWT_SECRET=(.*?)\r?$/m.exec(content)?.[1] ?? '';
}

describe('scripts/ensure-env.mjs', () => {
  it('creates .env from .env.example with a generated secret', () => {
    runEnsureEnv();

    const env = readEnv();
    const secret = secretIn(env);
    expect(secret).toMatch(GENERATED_SECRET);
    expect(env).toBe(EXAMPLE.replace('JWT_SECRET=\n', `JWT_SECRET=${secret}\n`));
  });

  it('never prints the generated secret', () => {
    const stdout = runEnsureEnv();

    expect(stdout).not.toContain(secretIn(readEnv()));
  });

  it('leaves .env byte-identical on the next run, so issued tokens survive a restart', () => {
    runEnsureEnv();
    const first = readEnv();

    runEnsureEnv();

    expect(readEnv()).toBe(first);
  });

  it.each([
    ['blank', ''],
    ['whitespace-only', ' \t '],
  ])('fills a %s secret and keeps CRLF line endings', (_label, blank) => {
    writeEnv(`PORT=4000\r\nJWT_SECRET=${blank}\r\nLOG_LEVEL=info\r\n`);

    runEnsureEnv();

    const env = readEnv();
    const secret = secretIn(env);
    expect(secret).toMatch(GENERATED_SECRET);
    expect(env).toBe(`PORT=4000\r\nJWT_SECRET=${secret}\r\nLOG_LEVEL=info\r\n`);
  });

  it.each([
    ['with a trailing newline', 'PORT=4000\n'],
    ['without a trailing newline', 'PORT=4000'],
  ])('appends a missing JWT_SECRET line to a file %s', (_label, content) => {
    writeEnv(content);

    runEnsureEnv();

    const env = readEnv();
    const secret = secretIn(env);
    expect(secret).toMatch(GENERATED_SECRET);
    expect(env).toBe(`PORT=4000\nJWT_SECRET=${secret}\n`);
  });

  it('keeps an existing .env and its secret unchanged', () => {
    const existing = 'PORT=5000\nJWT_SECRET=kept-secret\n';
    writeEnv(existing);

    runEnsureEnv();

    expect(readEnv()).toBe(existing);
  });
});
