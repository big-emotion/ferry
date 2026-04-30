import { beforeAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('CODEOWNERS coverage', () => {
  let content = '';

  beforeAll(() => {
    content = readFileSync(join(process.cwd(), '.github', 'CODEOWNERS'), 'utf-8');
  });

  it('CODEOWNERS file exists', () => {
    expect(content).not.toBe('');
  });

  it('protects .github/**', () => {
    expect(content).toMatch(/\.github\/\*\*/);
  });

  it('protects src/schemas/**', () => {
    expect(content).toMatch(/src\/schemas\/\*\*/);
  });

  it('protects agent prompts in /prompts/*.md', () => {
    expect(content).toMatch(/\/prompts\/\*\.md/);
  });

  it('protects composite-action prompts in /.github/actions/*/prompts/*.md', () => {
    expect(content).toMatch(/\/\.github\/actions\/\*\/prompts\/\*\.md/);
  });

  it('each protected pattern has at least one owner', () => {
    const lines = content.split('\n').filter((l) => !l.startsWith('#') && l.trim().length > 0);

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      expect(parts.length, `Line "${line}" must have at least one owner`).toBeGreaterThanOrEqual(2);
      expect(parts[1], `Owner on line "${line}" must start with @`).toMatch(/^@/);
    }
  });
});
