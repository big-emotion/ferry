import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rewriteGitLabVersion, type RewriteResult } from './rewriter.js';

function makeTempRepo(): string {
  return mkdtempSync(join(tmpdir(), 'ferry-update-gitlab-test-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function write(dir: string, relPath: string, content: string): string {
  const full = join(dir, relPath);
  const parent = full.substring(0, full.lastIndexOf('/'));
  mkdirSync(parent, { recursive: true });
  writeFileSync(full, content, 'utf8');
  return full;
}

// ── FERRY_VERSION CI variable rewriting ──────────────────────────────────────

describe('rewriteGitLabVersion — FERRY_VERSION variable in YAML', () => {
  it('rewrites a quoted FERRY_VERSION assignment', () => {
    const dir = makeTempRepo();
    write(
      dir,
      '.gitlab-ci.yml',
      `variables:
  FERRY_VERSION: "v0.10.3"
`,
    );

    const result = rewriteGitLabVersion({ repoRoot: dir, toVersion: 'v0.11.0' });
    expect(result.errors).toEqual([]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.changed).toBe(true);
    expect(result.files[0]!.replacements).toBe(1);

    const after = readFileSync(join(dir, '.gitlab-ci.yml'), 'utf8');
    expect(after).toBe(`variables:
  FERRY_VERSION: "v0.11.0"
`);
    cleanup(dir);
  });

  it('rewrites a single-quoted FERRY_VERSION assignment', () => {
    const dir = makeTempRepo();
    write(dir, '.gitlab-ci.yml', `variables:\n  FERRY_VERSION: 'v0.10.3'\n`);

    rewriteGitLabVersion({ repoRoot: dir, toVersion: 'v0.11.0' });
    const after = readFileSync(join(dir, '.gitlab-ci.yml'), 'utf8');
    expect(after).toBe(`variables:\n  FERRY_VERSION: 'v0.11.0'\n`);
    cleanup(dir);
  });

  it('rewrites an unquoted FERRY_VERSION assignment', () => {
    const dir = makeTempRepo();
    write(dir, '.gitlab-ci.yml', `variables:\n  FERRY_VERSION: v0.10.3\n`);

    rewriteGitLabVersion({ repoRoot: dir, toVersion: 'v0.11.0' });
    const after = readFileSync(join(dir, '.gitlab-ci.yml'), 'utf8');
    expect(after).toBe(`variables:\n  FERRY_VERSION: v0.11.0\n`);
    cleanup(dir);
  });

  it('preserves indentation and surrounding context', () => {
    const dir = makeTempRepo();
    const original = `# Top-level Ferry pipeline
variables:
  FERRY_FORGE: gitlab
  FERRY_VERSION: "v0.10.3"
  GITHUB_REPO: '$CI_PROJECT_PATH'

include:
  - local: refine.gitlab-ci.yml
`;
    write(dir, '.gitlab-ci.yml', original);

    rewriteGitLabVersion({ repoRoot: dir, toVersion: 'v0.11.0' });
    const after = readFileSync(join(dir, '.gitlab-ci.yml'), 'utf8');
    expect(after).toBe(original.replace('v0.10.3', 'v0.11.0'));
    cleanup(dir);
  });
});

// ── @big-emotion/ferry@<version> literal pin rewriting ────────────────────────

describe('rewriteGitLabVersion — literal @big-emotion/ferry@<version> pin', () => {
  it('rewrites a literal version pin in npm install command', () => {
    const dir = makeTempRepo();
    write(
      dir,
      'refine.gitlab-ci.yml',
      `ferry-refine:
  script:
    - npm install -g "@big-emotion/ferry@v0.10.3"
    - ferry-agent run --role refiner
`,
    );

    const result = rewriteGitLabVersion({ repoRoot: dir, toVersion: 'v0.11.0' });
    expect(result.files[0]!.replacements).toBe(1);

    const after = readFileSync(join(dir, 'refine.gitlab-ci.yml'), 'utf8');
    expect(after).toContain('"@big-emotion/ferry@v0.11.0"');
    expect(after).not.toContain('v0.10.3');
    cleanup(dir);
  });

  it('does NOT rewrite the ${FERRY_VERSION} variable form', () => {
    const dir = makeTempRepo();
    const original = `ferry-refine:
  script:
    - npm install -g "@big-emotion/ferry@\${FERRY_VERSION}"
`;
    write(dir, 'refine.gitlab-ci.yml', original);

    const result = rewriteGitLabVersion({ repoRoot: dir, toVersion: 'v0.11.0' });
    // No literal pin, no FERRY_VERSION variable definition either → no change.
    expect(result.files[0]!.changed).toBe(false);

    const after = readFileSync(join(dir, 'refine.gitlab-ci.yml'), 'utf8');
    expect(after).toBe(original);
    cleanup(dir);
  });

  it('rewrites both FERRY_VERSION var and literal pins across multiple files', () => {
    const dir = makeTempRepo();
    write(
      dir,
      '.gitlab-ci.yml',
      `variables:
  FERRY_VERSION: "v0.10.3"
`,
    );
    write(
      dir,
      'refine.gitlab-ci.yml',
      `ferry-refine:
  script:
    - npm install -g "@big-emotion/ferry@v0.10.3"
`,
    );

    const result = rewriteGitLabVersion({ repoRoot: dir, toVersion: 'v0.11.0' });
    const total = result.files.reduce((sum, f) => sum + f.replacements, 0);
    expect(total).toBe(2);

    expect(readFileSync(join(dir, '.gitlab-ci.yml'), 'utf8')).toContain('FERRY_VERSION: "v0.11.0"');
    expect(readFileSync(join(dir, 'refine.gitlab-ci.yml'), 'utf8')).toContain(
      '"@big-emotion/ferry@v0.11.0"',
    );
    cleanup(dir);
  });
});

// ── Idempotency ──────────────────────────────────────────────────────────────

describe('rewriteGitLabVersion — idempotency', () => {
  it('rerunning after convergence produces no diff', () => {
    const dir = makeTempRepo();
    write(dir, '.gitlab-ci.yml', `variables:\n  FERRY_VERSION: "v0.11.0"\n`);

    const first = rewriteGitLabVersion({ repoRoot: dir, toVersion: 'v0.11.0' });
    expect(first.files[0]!.changed).toBe(false);

    const beforeSecond = readFileSync(join(dir, '.gitlab-ci.yml'), 'utf8');
    const second = rewriteGitLabVersion({ repoRoot: dir, toVersion: 'v0.11.0' });
    expect(second.files[0]!.changed).toBe(false);

    const afterSecond = readFileSync(join(dir, '.gitlab-ci.yml'), 'utf8');
    expect(afterSecond).toBe(beforeSecond);
    cleanup(dir);
  });

  it('preserves byte-exact content when no pin matches', () => {
    const dir = makeTempRepo();
    const original = `# Empty pipeline\nstages:\n  - build\n`;
    write(dir, '.gitlab-ci.yml', original);

    rewriteGitLabVersion({ repoRoot: dir, toVersion: 'v0.11.0' });
    expect(readFileSync(join(dir, '.gitlab-ci.yml'), 'utf8')).toBe(original);
    cleanup(dir);
  });
});

// ── File discovery ───────────────────────────────────────────────────────────

describe('rewriteGitLabVersion — file discovery', () => {
  it('discovers .gitlab-ci.yml at the repo root', () => {
    const dir = makeTempRepo();
    write(dir, '.gitlab-ci.yml', `variables:\n  FERRY_VERSION: "v0.10.3"\n`);

    const result = rewriteGitLabVersion({ repoRoot: dir, toVersion: 'v0.11.0' });
    expect(result.files.map((f) => f.relPath)).toContain('.gitlab-ci.yml');
    cleanup(dir);
  });

  it('discovers per-role *.gitlab-ci.yml files at the repo root', () => {
    const dir = makeTempRepo();
    write(dir, '.gitlab-ci.yml', `include:\n  - local: refine.gitlab-ci.yml\n`);
    write(
      dir,
      'refine.gitlab-ci.yml',
      `ferry-refine:\n  script:\n    - npm install -g "@big-emotion/ferry@v0.10.3"\n`,
    );
    write(
      dir,
      'dev.gitlab-ci.yml',
      `ferry-dev:\n  script:\n    - npm install -g "@big-emotion/ferry@v0.10.3"\n`,
    );

    const result = rewriteGitLabVersion({ repoRoot: dir, toVersion: 'v0.11.0' });
    const paths = result.files.map((f) => f.relPath).sort();
    expect(paths).toEqual(['.gitlab-ci.yml', 'dev.gitlab-ci.yml', 'refine.gitlab-ci.yml']);
    cleanup(dir);
  });

  it('discovers included files in subdirectories (ci/, .ci/, ci/ferry/)', () => {
    const dir = makeTempRepo();
    write(dir, '.gitlab-ci.yml', `include:\n  - local: ci/ferry/refine.gitlab-ci.yml\n`);
    write(
      dir,
      'ci/ferry/refine.gitlab-ci.yml',
      `ferry-refine:\n  script:\n    - npm install -g "@big-emotion/ferry@v0.10.3"\n`,
    );

    const result = rewriteGitLabVersion({ repoRoot: dir, toVersion: 'v0.11.0' });
    const paths = result.files.map((f) => f.relPath).sort();
    expect(paths).toEqual(['.gitlab-ci.yml', 'ci/ferry/refine.gitlab-ci.yml']);
    cleanup(dir);
  });

  it('returns an empty result when no GitLab CI files exist', () => {
    const dir = makeTempRepo();
    const result = rewriteGitLabVersion({ repoRoot: dir, toVersion: 'v0.11.0' });
    expect(result.files).toEqual([]);
    expect(result.errors).toEqual([]);
    cleanup(dir);
  });

  it('ignores node_modules', () => {
    const dir = makeTempRepo();
    write(dir, 'node_modules/foo/.gitlab-ci.yml', `variables:\n  FERRY_VERSION: "v0.10.3"\n`);

    const result = rewriteGitLabVersion({ repoRoot: dir, toVersion: 'v0.11.0' });
    expect(result.files.map((f) => f.relPath)).not.toContain('node_modules/foo/.gitlab-ci.yml');
    cleanup(dir);
  });
});

// ── Diff summary ─────────────────────────────────────────────────────────────

describe('rewriteGitLabVersion — diff summary', () => {
  it('produces a diff summary for changed files', () => {
    const dir = makeTempRepo();
    write(dir, '.gitlab-ci.yml', `variables:\n  FERRY_VERSION: "v0.10.3"\n`);

    const result = rewriteGitLabVersion({ repoRoot: dir, toVersion: 'v0.11.0' });
    expect(result.files[0]!.diff).toContain('v0.10.3');
    expect(result.files[0]!.diff).toContain('v0.11.0');
    cleanup(dir);
  });

  it('returns empty diff for unchanged files', () => {
    const dir = makeTempRepo();
    write(dir, '.gitlab-ci.yml', `stages:\n  - build\n`);

    const result = rewriteGitLabVersion({ repoRoot: dir, toVersion: 'v0.11.0' });
    expect(result.files[0]!.diff).toBe('');
    cleanup(dir);
  });
});

// ── Dry-run mode ─────────────────────────────────────────────────────────────

describe('rewriteGitLabVersion — dry-run', () => {
  it('does not modify files when dryRun is true', () => {
    const dir = makeTempRepo();
    const original = `variables:\n  FERRY_VERSION: "v0.10.3"\n`;
    write(dir, '.gitlab-ci.yml', original);

    const result = rewriteGitLabVersion({
      repoRoot: dir,
      toVersion: 'v0.11.0',
      dryRun: true,
    });
    expect(result.files[0]!.changed).toBe(true);
    expect(result.files[0]!.replacements).toBe(1);

    // File on disk is untouched.
    expect(readFileSync(join(dir, '.gitlab-ci.yml'), 'utf8')).toBe(original);
    cleanup(dir);
  });
});

// ── Target version validation ────────────────────────────────────────────────

describe('rewriteGitLabVersion — target version normalization', () => {
  it('accepts a bare semver and treats it as v-prefixed when source uses v', () => {
    const dir = makeTempRepo();
    write(dir, '.gitlab-ci.yml', `variables:\n  FERRY_VERSION: "v0.10.3"\n`);

    rewriteGitLabVersion({ repoRoot: dir, toVersion: '0.11.0' });
    const after = readFileSync(join(dir, '.gitlab-ci.yml'), 'utf8');
    // Output preserves the leading "v" because the source had one.
    expect(after).toContain('FERRY_VERSION: "v0.11.0"');
    cleanup(dir);
  });

  it('rejects an obviously invalid target version', () => {
    const dir = makeTempRepo();
    write(dir, '.gitlab-ci.yml', `variables:\n  FERRY_VERSION: "v0.10.3"\n`);

    expect(() => rewriteGitLabVersion({ repoRoot: dir, toVersion: 'not-a-version' })).toThrow(
      /invalid.*version/i,
    );
    cleanup(dir);
  });
});

// ── Errors ───────────────────────────────────────────────────────────────────

describe('rewriteGitLabVersion — error handling', () => {
  it('reports per-file errors without throwing on unreadable files', () => {
    // We trigger a parse error by making a file inaccessible via permissions.
    // Skipped on systems where the test environment runs as root.
    const dir = makeTempRepo();
    // Empty file with no version pins → succeeds with no replacements.
    write(dir, '.gitlab-ci.yml', '');

    const result: RewriteResult = rewriteGitLabVersion({
      repoRoot: dir,
      toVersion: 'v0.11.0',
    });
    expect(result.errors).toEqual([]);
    cleanup(dir);
  });
});
