import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts on purpose: tests run in Node against the server code only.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
  },
});
