import { readFileSync, existsSync } from 'node:fs';
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

export function detectPackageManager(
  repoRoot: string,
  _checkExists: (p: string) => boolean = existsSync,
  _readFile: (p: string, enc: BufferEncoding) => string = (p, enc) => readFileSync(p, enc),
): string | null {
  const join = (file: string) => path.join(repoRoot, file);

  if (_checkExists(join('pnpm-lock.yaml'))) {
    return 'pnpm lockfile detected (`pnpm-lock.yaml`). Use pnpm for all install and script commands.';
  }

  if (_checkExists(join('package.json'))) {
    try {
      const pkg = JSON.parse(_readFile(join('package.json'), 'utf8')) as Record<string, unknown>;
      const pm = typeof pkg.packageManager === 'string' ? pkg.packageManager : '';
      if (pm.startsWith('pnpm')) {
        return 'pnpm declared in `package.json` (`packageManager` field). Use pnpm for all install and script commands.';
      }
      if (pm.startsWith('yarn')) {
        return 'yarn declared in `package.json` (`packageManager` field). Use yarn for all install and script commands.';
      }
      if (pm.startsWith('bun')) {
        return 'bun declared in `package.json` (`packageManager` field). Use bun for all install and script commands.';
      }
      if (pm.startsWith('npm')) {
        return 'npm declared in `package.json` (`packageManager` field). Use npm for all install and script commands.';
      }
    } catch {
      // ignore parse errors
    }
  }

  if (_checkExists(join('yarn.lock'))) {
    return 'yarn lockfile detected (`yarn.lock`). Use yarn for all install and script commands.';
  }
  if (_checkExists(join('bun.lockb'))) {
    return 'bun lockfile detected (`bun.lockb`). Use bun for all install and script commands.';
  }
  if (_checkExists(join('package-lock.json'))) {
    return 'npm lockfile detected (`package-lock.json`). Use npm for all install and script commands.';
  }

  const hasPyproject = _checkExists(join('pyproject.toml'));
  const hasRequirements = _checkExists(join('requirements.txt'));
  if (hasPyproject || hasRequirements) {
    const marker = hasPyproject ? 'pyproject.toml' : 'requirements.txt';
    return `Python project detected (\`${marker}\`). Use pip or the project's configured tool for dependency management.`;
  }

  if (_checkExists(join('Gemfile.lock'))) {
    return 'Ruby project detected (`Gemfile.lock`). Use bundler for dependency management.';
  }
  if (_checkExists(join('Cargo.lock'))) {
    return 'Rust project detected (`Cargo.lock`). Use cargo for dependency management.';
  }

  return null;
}
