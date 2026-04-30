import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'src/agents/__lint-fixtures__/**'],
  },
  // All TypeScript source — base rules + type-aware linting
  {
    files: ['src/**/*.ts'],
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
        project: './tsconfig.json',
      },
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  // Agent code must never import Octokit or Jira modules directly
  {
    files: ['src/agents/**/*.ts'],
    languageOptions: {
      // Do not require TS project membership for agent linting guardrails
      parserOptions: { project: null },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@octokit/rest'],
              message: 'Import Octokit only through src/lib/io/github.ts',
            },
            {
              group: ['**/io/jira*'],
              message: 'Agents must use src/lib/io/tracker/factory.ts, not Jira modules directly',
            },
            {
              group: ['node-fetch', 'undici'],
              message: 'Do not fetch APIs directly from agents; use the IO layer',
            },
          ],
        },
      ],
    },
  },
  prettierConfig,
];
