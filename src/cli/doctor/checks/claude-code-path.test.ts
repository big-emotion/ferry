import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mockExecSync = vi.hoisted(() => vi.fn());
const mockLoadFerryConfig = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('../../../lib/config.js', () => ({
  loadFerryConfig: mockLoadFerryConfig,
}));

import {
  resolveExecutionPath,
  checkClaudeCodePath,
  checkTokenExclusivity,
  checkProviderGate,
  checkWorkflowShape,
} from './claude-code-path.js';

function makeRepoRoot(): string {
  return mkdtempSync(join(tmpdir(), 'ferry-cc-path-'));
}

function writeConfig(root: string, obj: unknown): void {
  writeFileSync(join(root, 'ferry.config.json'), JSON.stringify(obj, null, 2));
}

function writeWorkflow(root: string, filename: string, content: string): void {
  const dir = join(root, '.github', 'workflows');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content);
}

const WORKFLOW_FILES = [
  'ferry-refine.yml',
  'ferry-dev.yml',
  'ferry-review.yml',
  'ferry-iterate.yml',
];

const V013_WORKFLOW_CONTENT = `
jobs:
  route:
    name: Resolve execution path
    steps:
      - uses: big-emotion/ferry/.github/actions/ferry-route@v0.13.0
  run-agent-claude-code:
    steps:
      - uses: big-emotion/ferry/.github/actions/ferry-cc-prepare@v0.13.0
      - uses: anthropics/claude-code-action@v1
      - uses: big-emotion/ferry/.github/actions/ferry-cc-apply@v0.13.0
`;

const V012_STALE_CONTENT = `
jobs:
  route:
    name: Resolve execution path
  run-agent-claude-code:
    steps:
      - name: claude-code execution path not yet wired
        run: exit 1
`;

const V012_ROUTE_ONLY_CONTENT = `
jobs:
  route:
    name: Resolve execution path
  run-agent:
    steps:
      - uses: big-emotion/ferry/.github/actions/ferry-run-refiner@v0.13.0
`;

const ALL_ANTHROPIC_CONFIG = {
  models: {
    refiner: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    dev: { provider: 'anthropic', model: 'claude-opus-4-5' },
    review: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    iterate: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  },
};

describe('resolveExecutionPath', () => {
  let root: string;
  beforeEach(() => {
    root = makeRepoRoot();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('defaults to script when no ferry.config.* is present', () => {
    expect(resolveExecutionPath(root)).toBe('script');
  });

  it('defaults to script when execution_path is absent', () => {
    writeConfig(root, { limits: { max_iterations: 3 } });
    expect(resolveExecutionPath(root)).toBe('script');
  });

  it('returns script when execution_path is explicitly "script"', () => {
    writeConfig(root, { execution_path: 'script' });
    expect(resolveExecutionPath(root)).toBe('script');
  });

  it('returns claude-code when execution_path is "claude-code"', () => {
    writeConfig(root, { execution_path: 'claude-code' });
    expect(resolveExecutionPath(root)).toBe('claude-code');
  });

  it('defaults to script for an unknown execution_path value', () => {
    writeConfig(root, { execution_path: 'magic' });
    expect(resolveExecutionPath(root)).toBe('script');
  });

  it('defaults to script when ferry.config.json is unparseable', () => {
    writeFileSync(join(root, 'ferry.config.json'), '{ not json');
    expect(resolveExecutionPath(root)).toBe('script');
  });
});

describe('checkClaudeCodePath', () => {
  let root: string;

  beforeEach(() => {
    vi.resetAllMocks();
    root = makeRepoRoot();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('skips (does not flag a missing token) when execution_path is script', async () => {
    writeConfig(root, { execution_path: 'script' });
    const res = await checkClaudeCodePath({ repoRoot: root, repo: 'owner/repo' });
    expect(res.status).toBe('skip');
    expect(res.detail).toContain('script');
  });

  it('skips when no ferry.config.* is present (default script)', async () => {
    const res = await checkClaudeCodePath({ repoRoot: root, repo: 'owner/repo' });
    expect(res.status).toBe('skip');
  });

  it('is red when execution_path is claude-code and the token is absent everywhere', async () => {
    writeConfig(root, { execution_path: 'claude-code' });
    mockExecSync.mockReturnValue(JSON.stringify([{ name: 'FERRY_APP_ID' }]));
    const res = await checkClaudeCodePath({ repoRoot: root, repo: 'owner/repo' });
    expect(res.status).toBe('red');
    expect(res.detail).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(res.remedy).toContain('claude setup-token');
  });

  it('is green when execution_path is claude-code and the secret exists in the repo', async () => {
    writeConfig(root, { execution_path: 'claude-code' });
    mockExecSync.mockReturnValue(
      JSON.stringify([{ name: 'FERRY_APP_ID' }, { name: 'CLAUDE_CODE_OAUTH_TOKEN' }]),
    );
    const res = await checkClaudeCodePath({ repoRoot: root, repo: 'owner/repo' });
    expect(res.status).toBe('green');
    expect(res.detail).toContain('claude-code');
  });

  it('is green when a well-formed token is supplied locally', async () => {
    writeConfig(root, { execution_path: 'claude-code' });
    const res = await checkClaudeCodePath({
      repoRoot: root,
      repo: 'owner/repo',
      claudeCodeOauthToken: 'sk-ant-oat01-abc123',
    });
    expect(res.status).toBe('green');
  });

  it('is yellow when the supplied token looks like an Anthropic API key (forbidden on this path)', async () => {
    writeConfig(root, { execution_path: 'claude-code' });
    const res = await checkClaudeCodePath({
      repoRoot: root,
      repo: 'owner/repo',
      claudeCodeOauthToken: 'sk-ant-api03-abc123',
    });
    expect(res.status).toBe('yellow');
    expect(res.detail.toLowerCase()).toContain('api key');
  });

  it('does not query repo secrets when execution_path is script', async () => {
    writeConfig(root, { execution_path: 'script' });
    await checkClaudeCodePath({ repoRoot: root, repo: 'owner/repo' });
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('is yellow when execution_path is claude-code but a model uses a non-Anthropic provider (issue #329)', async () => {
    writeConfig(root, {
      execution_path: 'claude-code',
      models: {
        refiner: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
        dev: { provider: 'openai', model: 'gpt-5' },
        review: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
        iterate: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      },
    });
    const res = await checkClaudeCodePath({ repoRoot: root, repo: 'owner/repo' });
    expect(res.status).toBe('yellow');
    expect(res.detail.toLowerCase()).toContain('provider');
    expect(res.detail).toContain('provider-gate');
  });

  it('does not warn about providers when execution_path is script (mixed-provider is valid for script)', async () => {
    writeConfig(root, {
      execution_path: 'script',
      models: { dev: { provider: 'openai', model: 'gpt-5' } },
    });
    const res = await checkClaudeCodePath({ repoRoot: root, repo: 'owner/repo' });
    expect(res.status).toBe('skip');
  });
});

describe('checkTokenExclusivity', () => {
  let root: string;

  beforeEach(() => {
    vi.resetAllMocks();
    root = makeRepoRoot();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('skips when execution_path is script', async () => {
    writeConfig(root, { execution_path: 'script' });
    const res = await checkTokenExclusivity({ repoRoot: root, repo: 'owner/repo' });
    expect(res.status).toBe('skip');
    expect(res.detail).toContain('script');
  });

  it('skips when no config is present (defaults to script)', async () => {
    const res = await checkTokenExclusivity({ repoRoot: root, repo: 'owner/repo' });
    expect(res.status).toBe('skip');
  });

  it('skips when no repo is provided', async () => {
    writeConfig(root, { execution_path: 'claude-code' });
    const res = await checkTokenExclusivity({ repoRoot: root });
    expect(res.status).toBe('skip');
    expect(res.detail).toContain('No repo');
  });

  it('is red when execution_path is claude-code and CLAUDE_CODE_OAUTH_TOKEN is absent', async () => {
    writeConfig(root, { execution_path: 'claude-code' });
    mockExecSync.mockReturnValue(JSON.stringify([{ name: 'FERRY_APP_ID' }]));
    const res = await checkTokenExclusivity({ repoRoot: root, repo: 'owner/repo' });
    expect(res.status).toBe('red');
    expect(res.detail).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(res.remedy).toContain('claude setup-token');
  });

  it('is yellow when both CLAUDE_CODE_OAUTH_TOKEN and ANTHROPIC_API_KEY are set (ADR-0006 §6 violation)', async () => {
    writeConfig(root, { execution_path: 'claude-code' });
    mockExecSync.mockReturnValue(
      JSON.stringify([{ name: 'CLAUDE_CODE_OAUTH_TOKEN' }, { name: 'ANTHROPIC_API_KEY' }]),
    );
    const res = await checkTokenExclusivity({ repoRoot: root, repo: 'owner/repo' });
    expect(res.status).toBe('yellow');
    expect(res.detail).toContain('mutual exclusion');
    expect(res.remedy).toContain('gh secret delete ANTHROPIC_API_KEY');
  });

  it('is green when CLAUDE_CODE_OAUTH_TOKEN is set and ANTHROPIC_API_KEY is absent', async () => {
    writeConfig(root, { execution_path: 'claude-code' });
    mockExecSync.mockReturnValue(
      JSON.stringify([{ name: 'CLAUDE_CODE_OAUTH_TOKEN' }, { name: 'FERRY_APP_ID' }]),
    );
    const res = await checkTokenExclusivity({ repoRoot: root, repo: 'owner/repo' });
    expect(res.status).toBe('green');
    expect(res.detail).toContain('ADR-0006 §6');
  });

  it('does not query secrets when execution_path is script', async () => {
    writeConfig(root, { execution_path: 'script' });
    await checkTokenExclusivity({ repoRoot: root, repo: 'owner/repo' });
    expect(mockExecSync).not.toHaveBeenCalled();
  });
});

describe('checkProviderGate', () => {
  let root: string;

  beforeEach(() => {
    vi.resetAllMocks();
    root = makeRepoRoot();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('skips when execution_path is script', () => {
    writeConfig(root, { execution_path: 'script' });
    const res = checkProviderGate({ repoRoot: root });
    expect(res.status).toBe('skip');
  });

  it('skips when no config is present (defaults to script)', () => {
    const res = checkProviderGate({ repoRoot: root });
    expect(res.status).toBe('skip');
  });

  it('is green when execution_path is claude-code and all four providers are anthropic', () => {
    writeConfig(root, { execution_path: 'claude-code' });
    mockLoadFerryConfig.mockReturnValue(ALL_ANTHROPIC_CONFIG);
    const res = checkProviderGate({ repoRoot: root });
    expect(res.status).toBe('green');
    expect(res.detail).toContain('anthropic');
    expect(res.detail).toContain('ADR-0006 §1');
  });

  it('is red when a single agent uses a non-anthropic provider', () => {
    writeConfig(root, { execution_path: 'claude-code' });
    mockLoadFerryConfig.mockReturnValue({
      models: {
        refiner: { provider: 'openai', model: 'gpt-4o' },
        dev: { provider: 'anthropic', model: 'claude-opus-4-5' },
        review: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        iterate: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      },
    });
    const res = checkProviderGate({ repoRoot: root });
    expect(res.status).toBe('red');
    expect(res.detail).toContain('refiner');
    expect(res.detail).toContain('script path at runtime');
    expect(res.remedy).toContain('ADR-0006 §1');
  });

  it('is red and names all non-anthropic agents when multiple are misconfigured', () => {
    writeConfig(root, { execution_path: 'claude-code' });
    mockLoadFerryConfig.mockReturnValue({
      models: {
        refiner: { provider: 'openai', model: 'gpt-4o' },
        dev: { provider: 'google', model: 'gemini-pro' },
        review: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        iterate: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      },
    });
    const res = checkProviderGate({ repoRoot: root });
    expect(res.status).toBe('red');
    expect(res.detail).toContain('refiner');
    expect(res.detail).toContain('dev');
  });

  it('is yellow when ferry.config.* cannot be parsed', () => {
    writeConfig(root, { execution_path: 'claude-code' });
    mockLoadFerryConfig.mockImplementation(() => {
      throw new Error('invalid config');
    });
    const res = checkProviderGate({ repoRoot: root });
    expect(res.status).toBe('yellow');
    expect(res.detail).toContain('could not be parsed');
  });
});

describe('checkWorkflowShape', () => {
  let root: string;

  beforeEach(() => {
    vi.resetAllMocks();
    root = makeRepoRoot();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('skips when execution_path is script', () => {
    writeConfig(root, { execution_path: 'script' });
    const res = checkWorkflowShape({ repoRoot: root });
    expect(res.status).toBe('skip');
  });

  it('skips when no config is present (defaults to script)', () => {
    const res = checkWorkflowShape({ repoRoot: root });
    expect(res.status).toBe('skip');
  });

  it('is green when all four workflows have the v0.13.0 cc chain', () => {
    writeConfig(root, { execution_path: 'claude-code' });
    for (const f of WORKFLOW_FILES) {
      writeWorkflow(root, f, V013_WORKFLOW_CONTENT);
    }
    const res = checkWorkflowShape({ repoRoot: root });
    expect(res.status).toBe('green');
    expect(res.detail).toContain('v0.13.0');
  });

  it('is yellow when workflows contain the v0.12.x stale placeholder', () => {
    writeConfig(root, { execution_path: 'claude-code' });
    for (const f of WORKFLOW_FILES) {
      writeWorkflow(root, f, V012_STALE_CONTENT);
    }
    const res = checkWorkflowShape({ repoRoot: root });
    expect(res.status).toBe('yellow');
    expect(res.detail).toContain('v0.12.x');
    expect(res.remedy).toContain('ferry-update');
    expect(res.remedy).toContain('MIGRATIONS.md');
  });

  it('names the stale workflow files in the detail', () => {
    writeConfig(root, { execution_path: 'claude-code' });
    writeWorkflow(root, 'ferry-dev.yml', V012_STALE_CONTENT);
    writeWorkflow(root, 'ferry-iterate.yml', V012_STALE_CONTENT);
    writeWorkflow(root, 'ferry-refine.yml', V013_WORKFLOW_CONTENT);
    writeWorkflow(root, 'ferry-review.yml', V013_WORKFLOW_CONTENT);
    const res = checkWorkflowShape({ repoRoot: root });
    expect(res.status).toBe('yellow');
    expect(res.detail).toContain('ferry-dev.yml');
    expect(res.detail).toContain('ferry-iterate.yml');
    expect(res.detail).not.toContain('ferry-refine.yml');
  });

  it('is yellow when workflows have a route job but are missing the cc chain', () => {
    writeConfig(root, { execution_path: 'claude-code' });
    for (const f of WORKFLOW_FILES) {
      writeWorkflow(root, f, V012_ROUTE_ONLY_CONTENT);
    }
    const res = checkWorkflowShape({ repoRoot: root });
    expect(res.status).toBe('yellow');
    expect(res.detail).toContain('ferry-cc-prepare');
    expect(res.remedy).toContain('ferry-update');
  });

  it('skips missing workflow files (covered by the Workflow files check)', () => {
    writeConfig(root, { execution_path: 'claude-code' });
    // Only write two of the four — the others are missing.
    writeWorkflow(root, 'ferry-dev.yml', V013_WORKFLOW_CONTENT);
    writeWorkflow(root, 'ferry-iterate.yml', V013_WORKFLOW_CONTENT);
    // ferry-refine.yml and ferry-review.yml are absent.
    const res = checkWorkflowShape({ repoRoot: root });
    // The two present files pass; the two missing files are skipped.
    expect(res.status).toBe('green');
  });

  it('does not check workflows when execution_path is script', () => {
    writeConfig(root, { execution_path: 'script' });
    // Write stale workflows — they should not be inspected.
    for (const f of WORKFLOW_FILES) {
      writeWorkflow(root, f, V012_STALE_CONTENT);
    }
    const res = checkWorkflowShape({ repoRoot: root });
    expect(res.status).toBe('skip');
  });
});
