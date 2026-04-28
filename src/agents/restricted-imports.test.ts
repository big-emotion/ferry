import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';

describe('agent lint guardrails', () => {
  it('blocks direct @octokit/rest imports in src/agents/**', () => {
    try {
      execSync('npx eslint src/agents/__lint-fixtures__/restricted-imports.ts --no-ignore', {
        stdio: 'pipe',
      });
      throw new Error('Expected eslint to fail but it succeeded');
    } catch (e) {
      const anyErr = e as unknown as { stdout?: Buffer; stderr?: Buffer };
      const output = `${anyErr.stdout?.toString?.() ?? ''}\n${anyErr.stderr?.toString?.() ?? ''}`;
      expect(output).toContain('no-restricted-imports');
    }
  });
});
