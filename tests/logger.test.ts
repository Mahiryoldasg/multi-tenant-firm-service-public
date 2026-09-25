import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/server/logger.ts';
import { createTestApp } from './helpers/app.ts';
import { userTokenFor } from './helpers/auth.ts';
import { TEST_SEED } from './helpers/db.ts';

describe('createLogger', () => {
  it('writes the Authorization header as [redacted], never the Bearer token', async () => {
    const lines: string[] = [];
    const logger = createLogger('info', { write: (line: string) => void lines.push(line) });
    const { app, db } = await createTestApp({ logger });
    const token = userTokenFor(db, TEST_SEED.firms[0].adminEmail);

    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    db.close();

    const output = lines.join('');
    expect(output).toContain('"authorization":"[redacted]"');
    expect(output).not.toContain(token);
  });
});
