import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createApp } from './app.ts';
import { type AppConfig, loadConfig } from './config.ts';
import { createLogger } from './logger.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

let config: AppConfig;
try {
  config = loadConfig();
} catch (error) {
  console.error(`\n[config] ${(error as Error).message}\n`);
  process.exit(1);
}

const logger = createLogger(config.logLevel);
const server = createServer(createApp({ logger }));

server.listen(config.port, () => {
  logger.info({ port: config.port }, `Server ready on http://localhost:${config.port}`);
});

function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, 'Shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
