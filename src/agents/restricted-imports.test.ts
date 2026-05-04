import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function collectTs(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectTs(full));
    } else if (entry.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

describe('agent lint guardrails', () => {
  it('blocks direct @octokit/rest imports in src/agents/**', () => {
    try {
      execSync(
        'node_modules/.bin/eslint src/agents/__lint-fixtures__/restricted-imports.ts --no-ignore',
        {
          stdio: 'pipe',
        },
      );
      throw new Error('Expected eslint to fail but it succeeded');
    } catch (e) {
      const anyErr = e as unknown as { stdout?: Buffer; stderr?: Buffer };
      const output = `${anyErr.stdout?.toString?.() ?? ''}\n${anyErr.stderr?.toString?.() ?? ''}`;
      expect(output).toContain('no-restricted-imports');
    }
  }, 30_000);

  it('no execSync with template literals in src/agents/', () => {
    const agentsDir = join(process.cwd(), 'src/agents');
    const files = collectTs(agentsDir);
    const violations = files.filter((f) => /execSync\s*\(`/.test(readFileSync(f, 'utf8')));
    expect(violations).toEqual([]);
  });
});
