import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist/', 'data/', 'coverage/', 'node_modules/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/server/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.mjs', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  // Tenancy boundary (build-plan item 5) is added here as a `no-restricted-imports` rule.
  prettier,
);
