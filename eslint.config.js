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
  // Structured logger required — console is forbidden in lib and agents; CLI entrypoints are exempt
  {
    files: ['src/agents/**/*.ts', 'src/lib/**/*.ts'],
    rules: {
      'no-console': 'error',
    },
  },
  // Layering invariant: `src/lib/agent-runtime/**` is the lower shared layer
  // and must never reach into `src/agents/**` (agents consume the lib layer,
  // not the other way around). See issue #330 / PR #345 for the rationale.
  {
    files: ['src/lib/agent-runtime/**/*.ts'],
    languageOptions: {
      parserOptions: { project: null },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/agents/**', '../../agents/**', '../agents/**'],
              message:
                'src/lib/agent-runtime/** must not import from src/agents/** — that inverts the lib/agents layering. Move shared helpers into src/lib/agent-runtime/ instead.',
            },
          ],
        },
      ],
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
              message: 'Import Octokit only through src/lib/dispatch/runner/github-actions/',
            },
            {
              group: ['**/io/jira*'],
              message: 'Agents must use src/lib/io/tracker/factory.ts, not Jira modules directly',
            },
            {
              group: ['**/tracker/jira*'],
              message: 'Import JiraTracker only through src/lib/io/tracker/factory.ts',
            },
            {
              group: ['node-fetch', 'undici'],
              message: 'Do not fetch APIs directly from agents; use the IO layer',
            },
            {
              group: ['**/labels/**'],
              message:
                'Import label utilities through src/lib/agent-runtime/ (not directly from labels/)',
            },
          ],
        },
      ],
    },
  },
  prettierConfig,
];
