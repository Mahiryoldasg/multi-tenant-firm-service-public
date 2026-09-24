// Reads configuration from environment variables only (contract §1). No secret has a default.
export interface AppConfig {
  port: number;
  jwtSecret: string;
  dbPath: string;
  userTokenTtl: string;
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
    userTokenTtl: env.USER_TOKEN_TTL?.trim() || '12h',
    logLevel: env.LOG_LEVEL?.trim() || 'info',
    seed: loadSeedConfig(env),
  };
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
