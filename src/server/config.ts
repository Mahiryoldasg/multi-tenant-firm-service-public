// Reads configuration from environment variables only (contract §1). No secret has a default.
export interface AppConfig {
  port: number;
  jwtSecret: string;
  dbPath: string;
  userTokenTtl: string;
  logLevel: string;
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
  };
}
