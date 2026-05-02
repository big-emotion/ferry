import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mockSpawnSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawnSync: mockSpawnSync,
}));

import {
  detectWorkflows,
  detectCodeownersBlock,
  detectSecrets,
  FERRY_WORKFLOW_FILES,
  FERRY_SECRETS,
  ANTHROPIC_SECRET,
  FERRY_VARIABLE,
} from './detect.js';
import {
  removeWorkflows,
  removeCodeownersBlock,
  removeSecrets,
  removeVariable,
  handleAuditIssue,
  type ExecOptions,
} from './execute.js';

function makeOpts(overrides?: Partial<ExecOptions>): ExecOptions & {
  actions: string[];
  skips: string[];
  errors: string[];
} {
  const actions: string[] = [];
  const skips: string[] = [];
  const errors: string[] = [];
  return {
    dryRun: false,
    onAction: (msg) => actions.push(msg),
    onSkip: (msg) => skips.push(msg),
    onError: (msg) => errors.push(msg),
    actions,
    skips,
    errors,
    ...overrides,
  };
}

function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ferry-uninstall-test-'));
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  return dir;
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function spawnOk(stdout = ''): ReturnType<typeof mockSpawnSync> {
  return { stdout, stderr: '', status: 0, error: null };
}

function spawnFail(stderr = 'error'): ReturnType<typeof mockSpawnSync> {
  return { stdout: '', stderr, status: 1, error: undefined };
}

// ── detectWorkflows ───────────────────────────────────────────────────────────

describe('detectWorkflows', () => {
  it('marks all workflows as not present in an empty dir', () => {
    const dir = makeTempRepo();
    const result = detectWorkflows(dir);
    expect(result).toHaveLength(FERRY_WORKFLOW_FILES.length);
    for (const item of result) {
      expect(item.present).toBe(false);
    }
    cleanup(dir);
  });

  it('marks present workflows correctly', () => {
    const dir = makeTempRepo();
    const workflowDir = join(dir, '.github', 'workflows');
    writeFileSync(join(workflowDir, 'ferry-refine.yml'), 'name: test', 'utf8');
    writeFileSync(join(workflowDir, 'ferry-dev.yml'), 'name: test', 'utf8');

    const result = detectWorkflows(dir);
    expect(result.find((w) => w.filename === 'ferry-refine.yml')?.present).toBe(true);
    expect(result.find((w) => w.filename === 'ferry-dev.yml')?.present).toBe(true);
    expect(result.find((w) => w.filename === 'ferry-review.yml')?.present).toBe(false);

    cleanup(dir);
  });

  it('returns all 6 ferry workflow filenames', () => {
    const dir = makeTempRepo();
    const names = detectWorkflows(dir).map((w) => w.filename);
    expect(names).toContain('ferry-refine.yml');
    expect(names).toContain('ferry-dev.yml');
    expect(names).toContain('ferry-review.yml');
    expect(names).toContain('ferry-iterate.yml');
    expect(names).toContain('ferry-reconciler.yml');
    expect(names).toContain('ferry-audit-daily.yml');
    cleanup(dir);
  });
});

// ── detectCodeownersBlock ─────────────────────────────────────────────────────

describe('detectCodeownersBlock', () => {
  it('returns false when CODEOWNERS does not exist', () => {
    const dir = makeTempRepo();
    expect(detectCodeownersBlock(dir)).toBe(false);
    cleanup(dir);
  });

  it('returns false when CODEOWNERS has no ferry lines', () => {
    const dir = makeTempRepo();
    writeFileSync(join(dir, '.github', 'CODEOWNERS'), '* @owner\n', 'utf8');
    expect(detectCodeownersBlock(dir)).toBe(false);
    cleanup(dir);
  });

  it('returns true when CODEOWNERS has a ferry entry', () => {
    const dir = makeTempRepo();
    writeFileSync(
      join(dir, '.github', 'CODEOWNERS'),
      '* @owner\n.github/workflows/ferry-*.yml @owner\n',
      'utf8',
    );
    expect(detectCodeownersBlock(dir)).toBe(true);
    cleanup(dir);
  });
});

// ── detectSecrets ─────────────────────────────────────────────────────────────

describe('detectSecrets', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('excludes ANTHROPIC_SECRET when includeAnthropic is false', () => {
    mockSpawnSync.mockReturnValue(
      spawnOk(JSON.stringify([...FERRY_SECRETS, ANTHROPIC_SECRET].map((name) => ({ name })))),
    );
    const secrets = detectSecrets('owner/repo', false);
    expect(secrets).not.toContain(ANTHROPIC_SECRET);
    expect(secrets).toHaveLength(FERRY_SECRETS.length);
  });

  it('includes ANTHROPIC_SECRET when includeAnthropic is true', () => {
    mockSpawnSync.mockReturnValue(
      spawnOk(JSON.stringify([...FERRY_SECRETS, ANTHROPIC_SECRET].map((name) => ({ name })))),
    );
    const secrets = detectSecrets('owner/repo', true);
    expect(secrets).toContain(ANTHROPIC_SECRET);
    expect(secrets).toHaveLength(FERRY_SECRETS.length + 1);
  });

  it('returns empty array when gh CLI fails', () => {
    mockSpawnSync.mockReturnValue(spawnFail('gh: not found'));
    expect(detectSecrets('owner/repo', false)).toEqual([]);
  });

  it('only returns secrets that exist in the repo', () => {
    mockSpawnSync.mockReturnValue(
      spawnOk(JSON.stringify([{ name: 'FERRY_APP_ID' }, { name: 'FERRY_PRIVATE_KEY' }])),
    );
    expect(detectSecrets('owner/repo', false)).toEqual(['FERRY_APP_ID', 'FERRY_PRIVATE_KEY']);
  });
});

// ── removeWorkflows ───────────────────────────────────────────────────────────

describe('removeWorkflows', () => {
  it('deletes present workflow files', () => {
    const dir = makeTempRepo();
    const workflowDir = join(dir, '.github', 'workflows');
    writeFileSync(join(workflowDir, 'ferry-refine.yml'), 'name: test', 'utf8');
    writeFileSync(join(workflowDir, 'ferry-dev.yml'), 'name: test', 'utf8');

    const opts = makeOpts();
    removeWorkflows(dir, detectWorkflows(dir), opts);

    expect(existsSync(join(workflowDir, 'ferry-refine.yml'))).toBe(false);
    expect(existsSync(join(workflowDir, 'ferry-dev.yml'))).toBe(false);
    expect(opts.actions).toContain('Deleted .github/workflows/ferry-refine.yml');
    expect(opts.actions).toContain('Deleted .github/workflows/ferry-dev.yml');

    cleanup(dir);
  });

  it('skips workflows that are not present', () => {
    const dir = makeTempRepo();
    const opts = makeOpts();
    removeWorkflows(dir, detectWorkflows(dir), opts);

    expect(opts.actions).toHaveLength(0);
    expect(opts.skips.length).toBeGreaterThan(0);

    cleanup(dir);
  });

  it('dry-run does not delete files', () => {
    const dir = makeTempRepo();
    const workflowDir = join(dir, '.github', 'workflows');
    writeFileSync(join(workflowDir, 'ferry-refine.yml'), 'name: test', 'utf8');

    const opts = makeOpts({ dryRun: true });
    removeWorkflows(dir, detectWorkflows(dir), opts);

    expect(existsSync(join(workflowDir, 'ferry-refine.yml'))).toBe(true);
    expect(opts.actions.some((a) => a.includes('[dry-run]'))).toBe(true);

    cleanup(dir);
  });

  it('handles partial install — deletes present, skips missing', () => {
    const dir = makeTempRepo();
    const workflowDir = join(dir, '.github', 'workflows');
    writeFileSync(join(workflowDir, 'ferry-refine.yml'), 'name: test', 'utf8');

    const opts = makeOpts();
    removeWorkflows(dir, detectWorkflows(dir), opts);

    expect(existsSync(join(workflowDir, 'ferry-refine.yml'))).toBe(false);
    expect(opts.actions.filter((a) => a.startsWith('Deleted'))).toHaveLength(1);
    expect(opts.skips.filter((s) => s.includes('not present'))).toHaveLength(
      FERRY_WORKFLOW_FILES.length - 1,
    );

    cleanup(dir);
  });
});

// ── removeCodeownersBlock ─────────────────────────────────────────────────────

describe('removeCodeownersBlock', () => {
  it('removes ferry lines from CODEOWNERS, keeps the file', () => {
    const dir = makeTempRepo();
    const codeownersPath = join(dir, '.github', 'CODEOWNERS');
    writeFileSync(
      codeownersPath,
      '* @owner\n# Ferry workflow files — only repo admins should modify these\n.github/workflows/ferry-*.yml @owner\n',
      'utf8',
    );

    const opts = makeOpts();
    removeCodeownersBlock(dir, opts);

    expect(existsSync(codeownersPath)).toBe(true);
    const content = readFileSync(codeownersPath, 'utf8');
    expect(content).not.toContain('ferry-');
    expect(content).toContain('* @owner');
    expect(opts.actions).toContain('Removed Ferry block from .github/CODEOWNERS (file kept)');

    cleanup(dir);
  });

  it('skips when CODEOWNERS is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ferry-no-codeowners-'));
    mkdirSync(join(dir, '.github'), { recursive: true });

    const opts = makeOpts();
    removeCodeownersBlock(dir, opts);

    expect(opts.skips.some((s) => s.includes('not present'))).toBe(true);
    expect(opts.actions).toHaveLength(0);

    cleanup(dir);
  });

  it('skips when CODEOWNERS has no ferry entries', () => {
    const dir = makeTempRepo();
    const codeownersPath = join(dir, '.github', 'CODEOWNERS');
    writeFileSync(codeownersPath, '* @owner\n', 'utf8');

    const opts = makeOpts();
    removeCodeownersBlock(dir, opts);

    expect(opts.skips.some((s) => s.includes('no Ferry entries'))).toBe(true);
    expect(opts.actions).toHaveLength(0);

    cleanup(dir);
  });

  it('dry-run does not modify CODEOWNERS', () => {
    const dir = makeTempRepo();
    const codeownersPath = join(dir, '.github', 'CODEOWNERS');
    const original = '* @owner\n.github/workflows/ferry-*.yml @owner\n';
    writeFileSync(codeownersPath, original, 'utf8');

    const opts = makeOpts({ dryRun: true });
    removeCodeownersBlock(dir, opts);

    expect(readFileSync(codeownersPath, 'utf8')).toBe(original);
    expect(opts.actions.some((a) => a.includes('[dry-run]'))).toBe(true);

    cleanup(dir);
  });

  it('keeps non-ferry lines intact', () => {
    const dir = makeTempRepo();
    const codeownersPath = join(dir, '.github', 'CODEOWNERS');
    writeFileSync(
      codeownersPath,
      '* @owner\nsrc/ @backend-team\n.github/workflows/ferry-*.yml @owner\ndocs/ @docs-team\n',
      'utf8',
    );

    removeCodeownersBlock(dir, makeOpts());

    const content = readFileSync(codeownersPath, 'utf8');
    expect(content).toContain('* @owner');
    expect(content).toContain('src/ @backend-team');
    expect(content).toContain('docs/ @docs-team');
    expect(content).not.toContain('ferry-');

    cleanup(dir);
  });
});

// ── removeSecrets ─────────────────────────────────────────────────────────────

describe('removeSecrets', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('calls gh secret delete for each secret', () => {
    mockSpawnSync.mockReturnValue(spawnOk());
    const opts = makeOpts();
    removeSecrets('owner/repo', ['FERRY_APP_ID', 'FERRY_PRIVATE_KEY'], opts);

    expect(mockSpawnSync).toHaveBeenCalledTimes(2);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'gh',
      ['secret', 'delete', 'FERRY_APP_ID', '--repo', 'owner/repo'],
      expect.any(Object),
    );
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'gh',
      ['secret', 'delete', 'FERRY_PRIVATE_KEY', '--repo', 'owner/repo'],
      expect.any(Object),
    );
    expect(opts.actions).toContain('Deleted secret FERRY_APP_ID');
    expect(opts.actions).toContain('Deleted secret FERRY_PRIVATE_KEY');
  });

  it('skips when no secrets provided', () => {
    const opts = makeOpts();
    removeSecrets('owner/repo', [], opts);

    expect(mockSpawnSync).not.toHaveBeenCalled();
    expect(opts.skips.some((s) => s.includes('No Ferry secrets'))).toBe(true);
  });

  it('reports errors when gh fails', () => {
    mockSpawnSync.mockReturnValue(spawnFail('gh: not authenticated'));
    const opts = makeOpts();
    removeSecrets('owner/repo', ['FERRY_APP_ID'], opts);

    expect(opts.errors.some((e) => e.includes('FERRY_APP_ID'))).toBe(true);
  });

  it('dry-run does not call gh', () => {
    const opts = makeOpts({ dryRun: true });
    removeSecrets('owner/repo', FERRY_SECRETS, opts);

    expect(mockSpawnSync).not.toHaveBeenCalled();
    expect(opts.actions.every((a) => a.includes('[dry-run]'))).toBe(true);
  });

  it('does not remove ANTHROPIC_SECRET unless explicitly included in list', () => {
    mockSpawnSync.mockReturnValue(spawnOk());
    const opts = makeOpts();
    removeSecrets('owner/repo', FERRY_SECRETS, opts);

    const calls = mockSpawnSync.mock.calls.map((c) => (c[1] as string[]).join(' '));
    expect(calls.some((c) => c.includes(ANTHROPIC_SECRET))).toBe(false);
  });

  it('removes ANTHROPIC_SECRET when included in the list', () => {
    mockSpawnSync.mockReturnValue(spawnOk());
    const opts = makeOpts();
    removeSecrets('owner/repo', [ANTHROPIC_SECRET], opts);

    expect(mockSpawnSync).toHaveBeenCalledWith(
      'gh',
      ['secret', 'delete', ANTHROPIC_SECRET, '--repo', 'owner/repo'],
      expect.any(Object),
    );
  });
});

// ── removeVariable ────────────────────────────────────────────────────────────

describe('removeVariable', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('calls gh variable delete', () => {
    mockSpawnSync.mockReturnValue(spawnOk());
    const opts = makeOpts();
    removeVariable('owner/repo', FERRY_VARIABLE, opts);

    expect(mockSpawnSync).toHaveBeenCalledWith(
      'gh',
      ['variable', 'delete', FERRY_VARIABLE, '--repo', 'owner/repo'],
      expect.any(Object),
    );
    expect(opts.actions).toContain(`Deleted repo variable ${FERRY_VARIABLE}`);
  });

  it('reports errors when gh fails', () => {
    mockSpawnSync.mockReturnValue(spawnFail('variable not found'));
    const opts = makeOpts();
    removeVariable('owner/repo', FERRY_VARIABLE, opts);

    expect(opts.errors.some((e) => e.includes(FERRY_VARIABLE))).toBe(true);
  });

  it('dry-run does not call gh', () => {
    const opts = makeOpts({ dryRun: true });
    removeVariable('owner/repo', FERRY_VARIABLE, opts);

    expect(mockSpawnSync).not.toHaveBeenCalled();
    expect(opts.actions.some((a) => a.includes('[dry-run]'))).toBe(true);
  });
});

// ── handleAuditIssue ──────────────────────────────────────────────────────────

describe('handleAuditIssue', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('removes label when issue has it', () => {
    mockSpawnSync.mockReturnValue(spawnOk());
    const opts = makeOpts();
    handleAuditIssue('owner/repo', { number: 42, hasLabel: true }, false, opts);

    const calls = mockSpawnSync.mock.calls.map((c) => (c[1] as string[]).join(' '));
    expect(calls.some((c) => c.includes('--remove-label') && c.includes('42'))).toBe(true);
    expect(opts.actions.some((a) => a.includes('#42'))).toBe(true);
  });

  it('skips label removal when issue lacks label', () => {
    const opts = makeOpts();
    handleAuditIssue('owner/repo', { number: 42, hasLabel: false }, false, opts);

    expect(mockSpawnSync).not.toHaveBeenCalled();
    expect(opts.skips.some((s) => s.includes('#42'))).toBe(true);
  });

  it('closes issue when closeIt is true', () => {
    mockSpawnSync.mockReturnValue(spawnOk());
    const opts = makeOpts();
    handleAuditIssue('owner/repo', { number: 42, hasLabel: false }, true, opts);

    const calls = mockSpawnSync.mock.calls.map((c) => (c[1] as string[]).join(' '));
    expect(calls.some((c) => c.includes('issue close') && c.includes('42'))).toBe(true);
  });

  it('does not close issue when closeIt is false', () => {
    mockSpawnSync.mockReturnValue(spawnOk());
    const opts = makeOpts();
    handleAuditIssue('owner/repo', { number: 42, hasLabel: true }, false, opts);

    const calls = mockSpawnSync.mock.calls.map((c) => (c[1] as string[]).join(' '));
    expect(calls.some((c) => c.includes('issue close'))).toBe(false);
  });

  it('dry-run does not call gh', () => {
    const opts = makeOpts({ dryRun: true });
    handleAuditIssue('owner/repo', { number: 42, hasLabel: true }, true, opts);

    expect(mockSpawnSync).not.toHaveBeenCalled();
    expect(opts.actions.every((a) => a.includes('[dry-run]'))).toBe(true);
  });

  it('reports errors on label removal failure', () => {
    mockSpawnSync.mockReturnValue(spawnFail('issue edit failed'));
    const opts = makeOpts();
    handleAuditIssue('owner/repo', { number: 42, hasLabel: true }, false, opts);

    expect(opts.errors.some((e) => e.includes('#42'))).toBe(true);
  });
});
