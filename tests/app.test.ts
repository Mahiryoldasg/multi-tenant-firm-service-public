import { describe, expect, it } from 'vitest';
import { isBackendPath } from '../src/server/app.ts';

// The SPA fallback mounts only when dist/web exists, which it never does in tests, so the predicate
// that keeps backend paths away from it is tested directly.
describe('isBackendPath', () => {
  it.each([
    '/api',
    '/api/employees',
    '/API/MODE',
    '/Api/Employees/x/y',
    '/DOCS',
    '/OpenAPI.json',
    '/Socket.IO/x',
    '/HEALTH',
  ])('treats %s as a backend path in any letter case', (urlPath) => {
    expect(isBackendPath(urlPath)).toBe(true);
  });

  it.each(['/', '/login', '/display', '/apix', '/API-docs', '/assets/index.js'])(
    'leaves %s to the SPA fallback',
    (urlPath) => {
      expect(isBackendPath(urlPath)).toBe(false);
    },
  );
});
