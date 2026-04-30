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
  // Agent code must never import Octokit directly — must go through the CIRunner interface
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
              message: 'Import Octokit only through src/lib/dispatch/runner/github-actions/',
            },
            {
              group: ['src/lib/io/github.js', 'src/lib/io/jira.js', 'src/lib/io/github.ts', 'src/lib/io/jira.ts'],
              message: 'Use the IO wrappers (src/lib/io/github.ts and src/lib/io/jira.ts), not direct REST clients',
            },
            {
              group: ['node-fetch', 'undici'],
              message: 'Do not fetch Jira directly from agents; use src/lib/io/jira.ts',
            },
          ],
        },
      ],
    },
  },
  prettierConfig,
];
