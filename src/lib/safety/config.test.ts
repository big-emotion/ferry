import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function hasExtendUseDefault(content: string): boolean {
  const normalized = content
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter((line) => line.length > 0)
    .join('\n');

  return normalized.includes('[extend]') && normalized.includes('useDefault = true');
}

describe('gitleaks config', () => {
  it('.gitleaks.toml exists and extends default rules', () => {
    const content = readFileSync(join(process.cwd(), '.gitleaks.toml'), 'utf-8');

    expect(content).not.toBe('');
    expect(hasExtendUseDefault(content)).toBe(true);
  });
});
