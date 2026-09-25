import { pino, type Logger } from 'pino';

/**
 * A logger that keeps every line it writes, so a test can check what reached the log. It has no
 * redaction on purpose: a secret that stays out of this output was never logged at all.
 */
export function createCapturingLogger(): { logger: Logger; output: () => string } {
  const lines: string[] = [];
  const logger = pino({ level: 'debug' }, { write: (line: string) => void lines.push(line) });
  return { logger, output: () => lines.join('') };
}
