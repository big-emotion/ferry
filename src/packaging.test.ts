import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Runtime-require packaging guard.
 *
 * The CLI bundles are built with esbuild (`scripts/build-cli.mjs`), which can
 * only inline statically imported modules. Anything loaded at runtime through
 * `createRequire(...)` stays a dynamic `require()` in the published bundle and
 * must therefore be resolvable from the installed package's `node_modules` —
 * i.e. declared in `dependencies`, not `devDependencies`.
 *
 * v1.1.0 shipped with `yaml` in `devDependencies` while `_require('yaml')`
 * parsed `ferry.local.yml` / `ferry.config.yaml` at runtime, so every
 * `npx -p @big-emotion/ferry` invocation that touched a YAML file crashed with
 * `Cannot find module 'yaml'`. This test locks the whole family: every bare
 * module specifier passed to `require()` in non-test source must be a declared
 * runtime dependency.
 */

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__fixtures__') return [];
      return collectSourceFiles(full);
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return [];
    return [full];
  });
}

/** Bare specifiers passed to require()/_require(), package root only. */
function runtimeRequiredPackages(source: string): string[] {
  const requireCalls = source.matchAll(/_?require\(\s*['"]([^'"]+)['"]\s*\)/g);
  const packages: string[] = [];
  for (const [, specifier] of requireCalls) {
    if (specifier.startsWith('.') || specifier.startsWith('/')) continue; // relative: bundled or shipped
    if (specifier.startsWith('node:')) continue; // Node built-in
    const root = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0];
    packages.push(root);
  }
  return packages;
}

describe('runtime require() packaging guard', () => {
  const srcRoot = join(process.cwd(), 'src');
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const requiredByFile = collectSourceFiles(srcRoot)
    .map((file) => ({ file, packages: runtimeRequiredPackages(readFileSync(file, 'utf8')) }))
    .filter(({ packages }) => packages.length > 0);

  it('finds the known runtime require sites (sanity check the scanner works)', () => {
    const allPackages = new Set(requiredByFile.flatMap(({ packages }) => packages));
    expect([...allPackages]).toContain('yaml');
    expect([...allPackages]).toContain('ajv');
  });

  it('every runtime-required bare module is declared in dependencies', () => {
    for (const { file, packages } of requiredByFile) {
      for (const packageName of packages) {
        expect(
          pkg.dependencies?.[packageName],
          `${file} loads "${packageName}" via require() at runtime — esbuild cannot bundle it, ` +
            `so it must be in package.json "dependencies" (devDependencies are not installed by npx)`,
        ).toBeDefined();
      }
    }
  });
});
