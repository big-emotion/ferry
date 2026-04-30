import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function isMinimalValidToml(content: string): boolean {
  // For this repo we only need to validate a minimal deterministic config.
  // TOML supports comments (#) and newlines; we strip comments and whitespace.
  const normalized = content
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter((line) => line.length > 0)
    .join('\n');

  return normalized === '[extend]\nuseDefault = true';
}

describe('gitleaks config', () => {
  it('.gitleaks.toml exists and is valid TOML for our minimal config', () => {
    const content = readFileSync(join(process.cwd(), '.gitleaks.toml'), 'utf-8');

    expect(content).not.toBe('');
    expect(isMinimalValidToml(content)).toBe(true);
  });
});
