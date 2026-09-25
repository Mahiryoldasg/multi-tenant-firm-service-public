import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/server/config.ts';

const SEED_VARIABLES = [
  'SEED_PLATFORM_ADMIN_EMAIL',
  'SEED_PLATFORM_ADMIN_PASSWORD',
  'SEED_FIRM1_NAME',
  'SEED_FIRM1_ADMIN_EMAIL',
  'SEED_FIRM1_ADMIN_PASSWORD',
  'SEED_FIRM2_NAME',
  'SEED_FIRM2_ADMIN_EMAIL',
  'SEED_FIRM2_ADMIN_PASSWORD',
];

// Every seed variable holds a distinct value, so a swapped mapping cannot go unnoticed.
const VALID_ENV: NodeJS.ProcessEnv = {
  JWT_SECRET: 'test-secret',
  ...Object.fromEntries(SEED_VARIABLES.map((name) => [name, `value-of-${name}`])),
};

describe('loadConfig seed values', () => {
  it('maps each SEED_* variable to its place in config.seed', () => {
    expect(loadConfig(VALID_ENV).seed).toEqual({
      platformAdmin: {
        email: 'value-of-SEED_PLATFORM_ADMIN_EMAIL',
        password: 'value-of-SEED_PLATFORM_ADMIN_PASSWORD',
      },
      firms: [
        {
          name: 'value-of-SEED_FIRM1_NAME',
          adminEmail: 'value-of-SEED_FIRM1_ADMIN_EMAIL',
          adminPassword: 'value-of-SEED_FIRM1_ADMIN_PASSWORD',
        },
        {
          name: 'value-of-SEED_FIRM2_NAME',
          adminEmail: 'value-of-SEED_FIRM2_ADMIN_EMAIL',
          adminPassword: 'value-of-SEED_FIRM2_ADMIN_PASSWORD',
        },
      ],
    });
  });

  it('reads a complete seed from .env.example, as a fresh clone does', () => {
    // ensure-env copies .env.example and generates JWT_SECRET; parseEnv is the parser behind
    // process.loadEnvFile.
    const example = parseEnv(readFileSync(new URL('../.env.example', import.meta.url), 'utf8'));

    const { seed } = loadConfig({ ...example, JWT_SECRET: 'test-secret' });

    expect(seed.platformAdmin.email).toBe('admin@platform.local');
    expect(seed.firms.map((firm) => [firm.name, firm.adminEmail])).toEqual([
      ['Acme Fuarcılık', 'admin@acme.local'],
      ['Globex Etkinlik', 'admin@globex.local'],
    ]);
  });

  it.each(SEED_VARIABLES)('rejects a missing or blank %s by name', (name) => {
    expect(() => loadConfig({ ...VALID_ENV, [name]: undefined })).toThrow(name);
    expect(() => loadConfig({ ...VALID_ENV, [name]: '  \t ' })).toThrow(name);
  });

  it('trims seed values', () => {
    const { seed } = loadConfig({
      ...VALID_ENV,
      SEED_FIRM1_NAME: '  Acme Fuarcılık  ',
      SEED_FIRM1_ADMIN_EMAIL: ' admin@acme.local\t',
    });

    expect(seed.firms[0].name).toBe('Acme Fuarcılık');
    expect(seed.firms[0].adminEmail).toBe('admin@acme.local');
  });
});

describe('loadConfig user token lifetime', () => {
  it.each([undefined, '', '  '])('defaults to 12 hours for %j', (value) => {
    expect(loadConfig({ ...VALID_ENV, USER_TOKEN_TTL: value }).userTokenTtlSeconds).toBe(43200);
  });

  it('reads 12 hours from .env.example', () => {
    const example = parseEnv(readFileSync(new URL('../.env.example', import.meta.url), 'utf8'));

    expect(loadConfig({ ...example, JWT_SECRET: 'test-secret' }).userTokenTtlSeconds).toBe(43200);
  });

  it.each([
    { value: '90s', seconds: 90 },
    { value: '30m', seconds: 1800 },
    { value: '12h', seconds: 43200 },
    { value: '7d', seconds: 604800 },
    { value: ' 12h ', seconds: 43200 },
  ])('converts "$value" to $seconds seconds', ({ value, seconds }) => {
    expect(loadConfig({ ...VALID_ENV, USER_TOKEN_TTL: value }).userTokenTtlSeconds).toBe(seconds);
  });

  // "12" is rejected on purpose: jsonwebtoken would read it as 12 milliseconds.
  it.each(['abc', '12', '0h', '-1h', '1.5h', '12 h', '12H'])('rejects "%s" by name', (value) => {
    expect(() => loadConfig({ ...VALID_ENV, USER_TOKEN_TTL: value })).toThrow('USER_TOKEN_TTL');
  });
});
