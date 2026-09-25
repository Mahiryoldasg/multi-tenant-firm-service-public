// Reads configuration from environment variables only (contract §1). No secret has a default.
export interface AppConfig {
  port: number;
  jwtSecret: string;
  dbPath: string;
  userTokenTtlSeconds: number;
  logLevel: string;
  seed: SeedConfig;
}

/** First-boot seed data: the platform admin and exactly two firms, each with its first admin. */
export interface SeedConfig {
  platformAdmin: { email: string; password: string };
  firms: readonly [SeedFirm, SeedFirm];
}

export interface SeedFirm {
  name: string;
  adminEmail: string;
  adminPassword: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const jwtSecret = env.JWT_SECRET?.trim();
  if (!jwtSecret) {
    throw new Error(
      'JWT_SECRET is not set. Run `npm start` (it creates .env) or provide JWT_SECRET in the environment.',
    );
  }

  const rawPort = env.PORT?.trim() || '4000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be an integer between 0 and 65535, got "${rawPort}".`);
  }

  return {
    port,
    jwtSecret,
    dbPath: env.DB_PATH?.trim() || './data/app.db',
    userTokenTtlSeconds: parseTokenTtl(env.USER_TOKEN_TTL?.trim() || '12h'),
    logLevel: env.LOG_LEVEL?.trim() || 'info',
    seed: loadSeedConfig(env),
  };
}

const SECONDS_PER_UNIT = { s: 1, m: 60, h: 3600, d: 86400 } as const;

// Converted to whole seconds here, because jsonwebtoken reads a bare numeric string such as "3600"
// as milliseconds. A bad value fails at boot instead of at the first login.
function parseTokenTtl(raw: string): number {
  const match = /^(\d+)([smhd])$/.exec(raw);
  const seconds = match
    ? Number(match[1]) * SECONDS_PER_UNIT[match[2] as keyof typeof SECONDS_PER_UNIT]
    : 0;
  if (!Number.isSafeInteger(seconds) || seconds < 1) {
    throw new Error(
      `USER_TOKEN_TTL must be a whole number followed by s, m, h or d (for example 12h), got "${raw}".`,
    );
  }
  return seconds;
}

// Required on every boot, not only the first, so a broken .env shows up immediately.
function loadSeedConfig(env: NodeJS.ProcessEnv): SeedConfig {
  const read = (name: string) => requireValue(env, name);
  return {
    platformAdmin: {
      email: read('SEED_PLATFORM_ADMIN_EMAIL'),
      password: read('SEED_PLATFORM_ADMIN_PASSWORD'),
    },
    firms: [
      {
        name: read('SEED_FIRM1_NAME'),
        adminEmail: read('SEED_FIRM1_ADMIN_EMAIL'),
        adminPassword: read('SEED_FIRM1_ADMIN_PASSWORD'),
      },
      {
        name: read('SEED_FIRM2_NAME'),
        adminEmail: read('SEED_FIRM2_ADMIN_EMAIL'),
        adminPassword: read('SEED_FIRM2_ADMIN_PASSWORD'),
      },
    ],
  };
}

function requireValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is not set. Add it to .env (see .env.example) or provide it in the environment.`,
    );
  }
  return value;
}
