import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { detectTestRunner, repoTree, packageJsonPath, detectPackageManager } from './workspace.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ferry-workspace-test-'));
});

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

describe('detectTestRunner', () => {
  it('detects vitest in devDependencies', async () => {
    await fsp.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ devDependencies: { vitest: '^2.0.0' } }),
    );
    expect(detectTestRunner(path.join(tmpDir, 'package.json'))).toBe('vitest');
  });

  it('detects jest in devDependencies', async () => {
    await fsp.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ devDependencies: { jest: '^29.0.0' } }),
    );
    expect(detectTestRunner(path.join(tmpDir, 'package.json'))).toBe('jest');
  });

  it('detects mocha in dependencies', async () => {
    await fsp.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { mocha: '^10.0.0' } }),
    );
    expect(detectTestRunner(path.join(tmpDir, 'package.json'))).toBe('mocha');
  });

  it('detects ava in devDependencies', async () => {
    await fsp.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ devDependencies: { ava: '^5.0.0' } }),
    );
    expect(detectTestRunner(path.join(tmpDir, 'package.json'))).toBe('ava');
  });

  it('detects node:test via scripts', async () => {
    await fsp.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'node:test ./src/**/*.test.js' } }),
    );
    expect(detectTestRunner(path.join(tmpDir, 'package.json'))).toBe('node:test');
  });

  it('returns none when no known runner is present', async () => {
    await fsp.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'my-pkg', version: '1.0.0' }),
    );
    expect(detectTestRunner(path.join(tmpDir, 'package.json'))).toBe('none');
  });

  it('returns none when file does not exist', () => {
    expect(detectTestRunner('/nonexistent/path/package.json')).toBe('none');
  });

  it('returns none when package.json contains invalid JSON', async () => {
    await fsp.writeFile(path.join(tmpDir, 'package.json'), 'not { valid json {{{');
    expect(detectTestRunner(path.join(tmpDir, 'package.json'))).toBe('none');
  });

  it('prefers vitest over jest when both are present', async () => {
    await fsp.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ devDependencies: { vitest: '^2.0.0', jest: '^29.0.0' } }),
    );
    expect(detectTestRunner(path.join(tmpDir, 'package.json'))).toBe('vitest');
  });

  it('finds runner in dependencies (not just devDependencies)', async () => {
    await fsp.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { jest: '^29.0.0' } }),
    );
    expect(detectTestRunner(path.join(tmpDir, 'package.json'))).toBe('jest');
  });

  it('falls through to node:test when no dep runner found but script matches', async () => {
    await fsp.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'pkg',
        scripts: { test: 'node --experimental-vm-modules node:test ./tests' },
      }),
    );
    expect(detectTestRunner(path.join(tmpDir, 'package.json'))).toBe('node:test');
  });
});

describe('repoTree', () => {
  it('returns file paths that include the root directory', async () => {
    await fsp.writeFile(path.join(tmpDir, 'index.ts'), 'export {}');
    const result = repoTree(tmpDir);
    expect(result).toContain(tmpDir);
  });

  it('includes files in the output', async () => {
    await fsp.writeFile(path.join(tmpDir, 'foo.ts'), 'export {}');
    const result = repoTree(tmpDir);
    expect(result).toContain('foo.ts');
  });

  it('returns (unavailable) for a non-existent directory', () => {
    expect(repoTree('/absolutely/does/not/exist/xyz987abc')).toBe('(unavailable)');
  });

  it('returns a newline-joined string (no blank entries)', async () => {
    await fsp.writeFile(path.join(tmpDir, 'a.ts'), '');
    await fsp.writeFile(path.join(tmpDir, 'b.ts'), '');
    const result = repoTree(tmpDir);
    const lines = result.split('\n');
    expect(lines.every((l) => l.length > 0)).toBe(true);
  });
});

describe('packageJsonPath', () => {
  it('joins repoRoot with package.json', () => {
    expect(packageJsonPath('/some/project')).toBe('/some/project/package.json');
  });

  it('returns a path ending in package.json', () => {
    expect(packageJsonPath('/any/path')).toMatch(/package\.json$/);
  });
});

describe('detectPackageManager', () => {
  const readFile = (files: Record<string, string>) => (p: string) => {
    if (p in files) return files[p];
    throw new Error(`ENOENT: ${p}`);
  };

  const checkExists = (present: string[]) => (p: string) => present.includes(p);

  it('detects pnpm via pnpm-lock.yaml', () => {
    const check = checkExists([`${tmpDir}/pnpm-lock.yaml`]);
    expect(detectPackageManager(tmpDir, check)).toContain('pnpm');
  });

  it('detects pnpm via packageManager field in package.json', () => {
    const check = checkExists([`${tmpDir}/package.json`]);
    const read = readFile({
      [`${tmpDir}/package.json`]: JSON.stringify({ packageManager: 'pnpm@9.0.0' }),
    });
    expect(detectPackageManager(tmpDir, check, read)).toContain('pnpm');
  });

  it('detects yarn via packageManager field', () => {
    const check = checkExists([`${tmpDir}/package.json`]);
    const read = readFile({
      [`${tmpDir}/package.json`]: JSON.stringify({ packageManager: 'yarn@4.0.0' }),
    });
    expect(detectPackageManager(tmpDir, check, read)).toContain('yarn');
  });

  it('detects bun via packageManager field', () => {
    const check = checkExists([`${tmpDir}/package.json`]);
    const read = readFile({
      [`${tmpDir}/package.json`]: JSON.stringify({ packageManager: 'bun@1.1.0' }),
    });
    expect(detectPackageManager(tmpDir, check, read)).toContain('bun');
  });

  it('detects npm via packageManager field', () => {
    const check = checkExists([`${tmpDir}/package.json`]);
    const read = readFile({
      [`${tmpDir}/package.json`]: JSON.stringify({ packageManager: 'npm@10.0.0' }),
    });
    expect(detectPackageManager(tmpDir, check, read)).toContain('npm');
  });

  it('detects yarn via yarn.lock', () => {
    const check = checkExists([`${tmpDir}/yarn.lock`]);
    expect(detectPackageManager(tmpDir, check)).toContain('yarn');
  });

  it('detects bun via bun.lockb', () => {
    const check = checkExists([`${tmpDir}/bun.lockb`]);
    expect(detectPackageManager(tmpDir, check)).toContain('bun');
  });

  it('detects npm via package-lock.json', () => {
    const check = checkExists([`${tmpDir}/package-lock.json`]);
    expect(detectPackageManager(tmpDir, check)).toContain('npm');
  });

  it('detects Python via pyproject.toml', () => {
    const check = checkExists([`${tmpDir}/pyproject.toml`]);
    expect(detectPackageManager(tmpDir, check)).toContain('Python');
  });

  it('detects Python via requirements.txt', () => {
    const check = checkExists([`${tmpDir}/requirements.txt`]);
    expect(detectPackageManager(tmpDir, check)).toContain('Python');
  });

  it('prefers pyproject.toml marker text when both Python markers exist', () => {
    const check = checkExists([`${tmpDir}/pyproject.toml`, `${tmpDir}/requirements.txt`]);
    expect(detectPackageManager(tmpDir, check)).toContain('pyproject.toml');
  });

  it('detects Ruby via Gemfile.lock', () => {
    const check = checkExists([`${tmpDir}/Gemfile.lock`]);
    expect(detectPackageManager(tmpDir, check)).toContain('Ruby');
  });

  it('detects Rust via Cargo.lock', () => {
    const check = checkExists([`${tmpDir}/Cargo.lock`]);
    expect(detectPackageManager(tmpDir, check)).toContain('Rust');
  });

  it('returns null when no marker is found', () => {
    const check = checkExists([]);
    expect(detectPackageManager(tmpDir, check)).toBeNull();
  });

  it('pnpm-lock.yaml takes priority over package-lock.json', () => {
    const check = checkExists([`${tmpDir}/pnpm-lock.yaml`, `${tmpDir}/package-lock.json`]);
    const result = detectPackageManager(tmpDir, check);
    expect(result).toContain('pnpm-lock.yaml');
    expect(result).not.toContain('package-lock.json');
  });

  it('pnpm-lock.yaml takes priority over packageManager field', () => {
    const check = checkExists([`${tmpDir}/pnpm-lock.yaml`, `${tmpDir}/package.json`]);
    const read = readFile({
      [`${tmpDir}/package.json`]: JSON.stringify({ packageManager: 'yarn@4.0.0' }),
    });
    const result = detectPackageManager(tmpDir, check, read);
    expect(result).toContain('pnpm');
  });

  it('packageManager field takes priority over yarn.lock', () => {
    const check = checkExists([`${tmpDir}/package.json`, `${tmpDir}/yarn.lock`]);
    const read = readFile({
      [`${tmpDir}/package.json`]: JSON.stringify({ packageManager: 'bun@1.1.0' }),
    });
    const result = detectPackageManager(tmpDir, check, read);
    expect(result).toContain('bun');
  });

  it('falls back to lockfile when package.json has no packageManager field', () => {
    const check = checkExists([`${tmpDir}/package.json`, `${tmpDir}/yarn.lock`]);
    const read = readFile({ [`${tmpDir}/package.json`]: JSON.stringify({ name: 'pkg' }) });
    const result = detectPackageManager(tmpDir, check, read);
    expect(result).toContain('yarn');
  });

  it('falls back to lockfile when package.json contains invalid JSON', () => {
    const check = checkExists([`${tmpDir}/package.json`, `${tmpDir}/yarn.lock`]);
    const read = readFile({ [`${tmpDir}/package.json`]: 'not { valid' });
    const result = detectPackageManager(tmpDir, check, read);
    expect(result).toContain('yarn');
  });
});
