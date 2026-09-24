import { pino, type Logger } from 'pino';

// Structured JSON logs. Credentials must never reach the log output.
export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: ['req.headers.authorization', 'password', 'adminPassword', '*.password'],
      censor: '[redacted]',
    },
  });
}
