import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../prompt.js', () => ({
  printSuccess: vi.fn(),
  printSkip: vi.fn(),
  printWarn: vi.fn(),
  printError: vi.fn(),
  print: vi.fn(),
}));

import { installGitLabTemplates } from './scaffold.js';
import type { WorkflowEntry } from '../types.js';

const TEMPLATES: WorkflowEntry[] = [
  { filename: 'refine.gitlab-ci.yml', content: 'refine-gitlab-content' },
  { filename: 'dev.gitlab-ci.yml', content: 'dev-gitlab-content' },
];

describe('installGitLabTemplates', () => {
  let tmpDir: string;

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('writes templates to <repoRoot>/ci/ferry/ on a fresh project', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-gl-new-'));

    const result = installGitLabTemplates(tmpDir, TEMPLATES, { overwrite: false, dryRun: false });

    expect(result.ok).toBe(true);
    expect(existsSync(join(tmpDir, 'ci', 'ferry', 'refine.gitlab-ci.yml'))).toBe(true);
    expect(existsSync(join(tmpDir, 'ci', 'ferry', 'dev.gitlab-ci.yml'))).toBe(true);
    expect(readFileSync(join(tmpDir, 'ci', 'ferry', 'refine.gitlab-ci.yml'), 'utf8')).toBe(
      'refine-gitlab-content',
    );
    expect(result.installed).toEqual(['refine.gitlab-ci.yml', 'dev.gitlab-ci.yml']);
    expect(result.skipped).toEqual([]);
  });

  it('is idempotent: re-running on an unchanged tree skips every file', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-gl-idempotent-'));

    installGitLabTemplates(tmpDir, TEMPLATES, { overwrite: false, dryRun: false });
    const second = installGitLabTemplates(tmpDir, TEMPLATES, { overwrite: false, dryRun: false });

    expect(second.ok).toBe(true);
    expect(second.installed).toEqual([]);
    expect(second.skipped).toEqual(['refine.gitlab-ci.yml', 'dev.gitlab-ci.yml']);
  });

  it('does not overwrite when content differs and overwrite is false (re-run prints diff intent)', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-gl-noover-'));

    installGitLabTemplates(tmpDir, TEMPLATES, { overwrite: false, dryRun: false });
    writeFileSync(join(tmpDir, 'ci', 'ferry', 'refine.gitlab-ci.yml'), 'modified-by-user', 'utf8');

    const result = installGitLabTemplates(tmpDir, TEMPLATES, { overwrite: false, dryRun: false });

    expect(result.ok).toBe(true);
    expect(readFileSync(join(tmpDir, 'ci', 'ferry', 'refine.gitlab-ci.yml'), 'utf8')).toBe(
      'modified-by-user',
    );
    expect(result.wouldOverwrite).toContain('refine.gitlab-ci.yml');
  });

  it('overwrites a drifted file when overwrite is true', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-gl-over-'));

    installGitLabTemplates(tmpDir, TEMPLATES, { overwrite: false, dryRun: false });
    writeFileSync(join(tmpDir, 'ci', 'ferry', 'refine.gitlab-ci.yml'), 'old', 'utf8');

    installGitLabTemplates(tmpDir, TEMPLATES, { overwrite: true, dryRun: false });

    expect(readFileSync(join(tmpDir, 'ci', 'ferry', 'refine.gitlab-ci.yml'), 'utf8')).toBe(
      'refine-gitlab-content',
    );
  });

  it('dry-run does not touch the filesystem (reports what would change only)', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-gl-dry-'));

    const result = installGitLabTemplates(tmpDir, TEMPLATES, { overwrite: false, dryRun: true });

    expect(result.ok).toBe(true);
    expect(existsSync(join(tmpDir, 'ci', 'ferry', 'refine.gitlab-ci.yml'))).toBe(false);
    expect(result.wouldInstall).toEqual(['refine.gitlab-ci.yml', 'dev.gitlab-ci.yml']);
  });

  it('dry-run on a drifted file reports it as wouldOverwrite, never installs', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-gl-dry-drift-'));

    installGitLabTemplates(tmpDir, TEMPLATES, { overwrite: false, dryRun: false });
    writeFileSync(join(tmpDir, 'ci', 'ferry', 'refine.gitlab-ci.yml'), 'drift', 'utf8');

    const result = installGitLabTemplates(tmpDir, TEMPLATES, { overwrite: false, dryRun: true });

    expect(result.wouldOverwrite).toContain('refine.gitlab-ci.yml');
    expect(readFileSync(join(tmpDir, 'ci', 'ferry', 'refine.gitlab-ci.yml'), 'utf8')).toBe('drift');
  });
});
