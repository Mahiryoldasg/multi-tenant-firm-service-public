import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts on purpose: tests run in Node against the server code and the UI's
// DOM-free modules (tests/web).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
  },
});
