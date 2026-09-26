import { type DestinationStream, pino, type Logger } from 'pino';

// Structured JSON logs. Credentials must never reach the log output. Without a destination, pino
// writes to stdout; tests pass one to read what was written.
export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      redact: {
        paths: [
          'req.headers.authorization',
          'password',
          'adminPassword',
          '*.password',
          '*.adminPassword',
        ],
        censor: '[redacted]',
      },
    },
    destination,
  );
}
