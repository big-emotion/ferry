import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

export function detectTestRunner(packageJsonPath: string): string {
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } as Record<
      string,
      string
    >;
    if (deps.vitest) return 'vitest';
    if (deps.jest) return 'jest';
    if (deps.mocha) return 'mocha';
    if (deps.ava) return 'ava';
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    if (Object.values(scripts).some((s) => s.includes('node:test'))) return 'node:test';
    return 'none';
  } catch {
    return 'none';
  }
}

export function repoTree(repoRoot: string): string {
  try {
    return execFileSync(
      'find',
      [
        repoRoot,
        '-maxdepth',
        '2',
        '-not',
        '-path',
        '*/node_modules/*',
        '-not',
        '-path',
        '*/.git/*',
      ],
      { encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      .join('\n');
  } catch {
    return '(unavailable)';
  }
}

export function packageJsonPath(repoRoot: string): string {
  return path.join(repoRoot, 'package.json');
}
