import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/__fixtures__/**',
        'src/**/__lint-fixtures__/**',
        'src/**/types.ts',
        'src/schemas/**',
        // GitHub Actions composite-action entrypoints — exercised end-to-end by
        // workflows, not by unit tests.
        'src/**/*-action.ts',
        // CLI bin entrypoints (consumer-facing scripts) — exercised via
        // ferry-init / ferry-doctor integration runs.
        'src/cli/**/index.ts',
        'src/cli/**/prompt.ts',
      ],
      // Ratcheted up after adding CLI module tests (issue #85).
      thresholds: {
        statements: 75,
        branches: 75,
        functions: 75,
        lines: 75,
      },
    },
  },
});
