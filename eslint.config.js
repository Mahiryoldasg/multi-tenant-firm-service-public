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
  // Tenancy boundary: tenant route code gets its data only through `req.tenant`, so it may not import
  // the database driver, a db module or a platform module. Patterns match the relative specifiers
  // from any folder depth; type-only imports and re-exports are reported too.
  {
    files: ['src/server/modules/tenant/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['better-sqlite3', '**/db/**', '**/platform/**'],
              message:
                'Tenant code reads data only through req.tenant (getTenant): no database driver, db module or platform module.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
