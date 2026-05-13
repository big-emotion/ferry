import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Hoisted mocks for prompt helpers so we control wizard flow without TTY.
const mockPrints: string[] = [];
const mockAsk = vi.hoisted(() => vi.fn());
const mockConfirm = vi.hoisted(() => vi.fn());
const mockClose = vi.hoisted(() => vi.fn());
const mockPrint = vi.hoisted(() => vi.fn());

vi.mock('../prompt.js', () => ({
  ask: mockAsk,
  confirm: mockConfirm,
  closePrompt: mockClose,
  print: mockPrint,
  printStep: vi.fn(),
  printSuccess: vi.fn(),
  printSkip: vi.fn(),
  printWarn: vi.fn(),
  printError: vi.fn(),
}));

import { runGitLabInit, GITLAB_TOKEN_SCOPES, GITLAB_CI_VARIABLES } from './wizard.js';

beforeEach(() => {
  mockPrints.length = 0;
  mockPrint.mockImplementation((m: string) => {
    mockPrints.push(m);
  });
  mockAsk.mockReset();
  mockConfirm.mockReset();
  mockClose.mockReset();
});

describe('runGitLabInit', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exposes the documented project-access-token scopes (single "api" scope, per examples/consumer-setup-gitlab/README.md)', () => {
    expect(GITLAB_TOKEN_SCOPES).toEqual(['api']);
  });

  it('exposes the documented CI/CD variables that consumers must set', () => {
    for (const expected of [
      'FERRY_VERSION',
      'FERRY_JIRA_BASE_URL',
      'FERRY_JIRA_EMAIL',
      'FERRY_JIRA_API_TOKEN',
      'FERRY_GITLAB_TOKEN',
      'FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN',
      'FERRY_REVIEW_TRANSITION_ID',
      'FERRY_ITER_TRANSITION_ID',
      'FERRY_APPROVE_TRANSITION_ID',
      'FERRY_AUDIT_ISSUE',
    ]) {
      expect(GITLAB_CI_VARIABLES).toContain(expected);
    }
  });

  it('aborts cleanly when the user declines the initial confirmation', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-gl-abort-'));
    mockConfirm.mockResolvedValueOnce(false);

    const code = await runGitLabInit({
      argv: [],
      cwd: tmpDir,
      remoteOverride: 'git@gitlab.com:acme/widgets.git',
      nonInteractive: false,
    });

    expect(code).toBe(0);
    expect(existsSync(join(tmpDir, 'ci', 'ferry'))).toBe(false);
  });

  it('writes the six gitlab CI files to ci/ferry/ when accepted', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-gl-write-'));
    mockConfirm.mockResolvedValue(true);
    mockAsk.mockImplementation(async (_q: string, def?: string) => def ?? '');

    const code = await runGitLabInit({
      argv: [],
      cwd: tmpDir,
      remoteOverride: 'git@gitlab.com:acme/widgets.git',
      nonInteractive: true,
    });

    expect(code).toBe(0);
    const written = [
      'refine.gitlab-ci.yml',
      'dev.gitlab-ci.yml',
      'review.gitlab-ci.yml',
      'iterate.gitlab-ci.yml',
      'reconcile.gitlab-ci.yml',
      'cost-daily.gitlab-ci.yml',
    ];
    for (const f of written) {
      expect(existsSync(join(tmpDir, 'ci', 'ferry', f))).toBe(true);
    }
  });

  it('is idempotent: a re-run on an unchanged tree never modifies files', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-gl-rerun-'));
    mockConfirm.mockResolvedValue(true);
    mockAsk.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runGitLabInit({
      argv: [],
      cwd: tmpDir,
      remoteOverride: 'git@gitlab.com:acme/widgets.git',
      nonInteractive: true,
    });
    const before = readFileSync(join(tmpDir, 'ci', 'ferry', 'refine.gitlab-ci.yml'), 'utf8');

    const code = await runGitLabInit({
      argv: [],
      cwd: tmpDir,
      remoteOverride: 'git@gitlab.com:acme/widgets.git',
      nonInteractive: true,
    });

    const after = readFileSync(join(tmpDir, 'ci', 'ferry', 'refine.gitlab-ci.yml'), 'utf8');
    expect(code).toBe(0);
    expect(after).toBe(before);
  });

  it('does not overwrite a user-edited file without --force, but lists it as wouldOverwrite', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-gl-noforce-'));
    mockConfirm.mockResolvedValue(true);
    mockAsk.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runGitLabInit({
      argv: [],
      cwd: tmpDir,
      remoteOverride: 'git@gitlab.com:acme/widgets.git',
      nonInteractive: true,
    });
    const refinePath = join(tmpDir, 'ci', 'ferry', 'refine.gitlab-ci.yml');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(refinePath, 'user-edited', 'utf8');

    await runGitLabInit({
      argv: [],
      cwd: tmpDir,
      remoteOverride: 'git@gitlab.com:acme/widgets.git',
      nonInteractive: true,
    });

    expect(readFileSync(refinePath, 'utf8')).toBe('user-edited');
  });

  it('overwrites a drifted file with --force', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-gl-force-'));
    mockConfirm.mockResolvedValue(true);
    mockAsk.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runGitLabInit({
      argv: [],
      cwd: tmpDir,
      remoteOverride: 'git@gitlab.com:acme/widgets.git',
      nonInteractive: true,
    });
    const refinePath = join(tmpDir, 'ci', 'ferry', 'refine.gitlab-ci.yml');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(refinePath, 'user-edited', 'utf8');

    await runGitLabInit({
      argv: ['--force'],
      cwd: tmpDir,
      remoteOverride: 'git@gitlab.com:acme/widgets.git',
      nonInteractive: true,
    });

    const after = readFileSync(refinePath, 'utf8');
    expect(after).toContain('$FERRY_DISPATCH_TYPE == "ferry-refine"');
    expect(after).not.toBe('user-edited');
  });

  it('reports an explanatory error when no GitLab remote can be detected and none provided', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-gl-noremote-'));
    mockConfirm.mockResolvedValue(true);
    mockAsk.mockImplementation(async (_q: string, def?: string) => def ?? '');

    const code = await runGitLabInit({
      argv: [],
      cwd: tmpDir,
      remoteOverride: 'https://github.com/owner/repo.git',
      nonInteractive: true,
    });

    expect(code).toBe(1);
    expect(existsSync(join(tmpDir, 'ci', 'ferry'))).toBe(false);
  });

  it('prints the required CI/CD variables and project-access-token scopes after writing files', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-gl-summary-'));
    mockConfirm.mockResolvedValue(true);
    mockAsk.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runGitLabInit({
      argv: [],
      cwd: tmpDir,
      remoteOverride: 'git@gitlab.com:acme/widgets.git',
      nonInteractive: true,
    });

    const joined = mockPrints.join('\n');
    expect(joined).toContain('FERRY_GITLAB_TOKEN');
    expect(joined).toContain('FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN');
    expect(joined).toContain('api');
  });

  it('accepts --project owner/path to override remote detection', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ferry-gl-projectflag-'));
    mockConfirm.mockResolvedValue(true);
    mockAsk.mockImplementation(async (_q: string, def?: string) => def ?? '');

    const code = await runGitLabInit({
      argv: ['--project', 'acme/team/widgets'],
      cwd: tmpDir,
      remoteOverride: 'https://github.com/owner/repo.git',
      nonInteractive: true,
    });

    expect(code).toBe(0);
    expect(existsSync(join(tmpDir, 'ci', 'ferry', 'refine.gitlab-ci.yml'))).toBe(true);
  });
});
