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
  checkCodexCliPath,
  checkProviderGate,
  checkWorkflowShape,
} from './codex-cli-path.js';

function makeRepoRoot(): string {
  return mkdtempSync(join(tmpdir(), 'ferry-codex-path-'));
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
  'ferry-merge.yml',
];

const CURRENT_WORKFLOW_CONTENT = `
jobs:
  route:
    name: Resolve execution path
    steps:
      - uses: big-emotion/ferry/.github/actions/ferry-route@v0.18.0
  run-agent-codex-cli:
    steps:
      - uses: openai/codex-action@a26d2d4d8b78a694338b8e3715c3630254340b2c # v1
`;

const MISSING_STEP_CONTENT = `
jobs:
  route:
    name: Resolve execution path
  run-agent:
    steps:
      - uses: big-emotion/ferry/.github/actions/ferry-run-refiner@v0.18.0
`;

const ALL_OPENAI_CONFIG = {
  models: {
    refiner: { provider: 'openai', model: 'gpt-5-codex' },
    dev: { provider: 'openai', model: 'gpt-5-codex' },
    review: { provider: 'openai', model: 'gpt-5-codex' },
    iterate: { provider: 'openai', model: 'gpt-5-codex' },
    merger: { provider: 'openai', model: 'gpt-5-codex' },
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

  it('returns codex-cli when execution_path is "codex-cli"', () => {
    writeConfig(root, { execution_path: 'codex-cli' });
    expect(resolveExecutionPath(root)).toBe('codex-cli');
  });
});

describe('checkCodexCliPath', () => {
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
    const res = await checkCodexCliPath({ repoRoot: root, repo: 'owner/repo' });
    expect(res.status).toBe('skip');
  });

  it('is red when execution_path is codex-cli and OPENAI_API_KEY is absent', async () => {
    writeConfig(root, { execution_path: 'codex-cli' });
    mockExecSync.mockReturnValue(JSON.stringify([{ name: 'FERRY_APP_ID' }]));
    const res = await checkCodexCliPath({ repoRoot: root, repo: 'owner/repo' });
    expect(res.status).toBe('red');
    expect(res.detail).toContain('OPENAI_API_KEY');
  });

  it('is green when execution_path is codex-cli and the secret exists in the repo', async () => {
    writeConfig(root, { execution_path: 'codex-cli' });
    mockExecSync.mockReturnValue(
      JSON.stringify([{ name: 'FERRY_APP_ID' }, { name: 'OPENAI_API_KEY' }]),
    );
    const res = await checkCodexCliPath({ repoRoot: root, repo: 'owner/repo' });
    expect(res.status).toBe('green');
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

  it('is green when execution_path is codex-cli and all configured providers are openai', () => {
    writeConfig(root, { execution_path: 'codex-cli' });
    mockLoadFerryConfig.mockReturnValue(ALL_OPENAI_CONFIG);
    const res = checkProviderGate({ repoRoot: root });
    expect(res.status).toBe('green');
  });

  it('is red when a configured agent uses a non-openai provider', () => {
    writeConfig(root, { execution_path: 'codex-cli' });
    mockLoadFerryConfig.mockReturnValue({
      models: {
        refiner: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        dev: { provider: 'openai', model: 'gpt-5-codex' },
      },
    });
    const res = checkProviderGate({ repoRoot: root });
    expect(res.status).toBe('red');
    expect(res.detail).toContain('refiner');
    expect(res.detail).toContain('OpenAI');
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

  it('is green when all five workflows contain run-agent-codex-cli with openai/codex-action', () => {
    writeConfig(root, { execution_path: 'codex-cli' });
    for (const f of WORKFLOW_FILES) {
      writeWorkflow(root, f, CURRENT_WORKFLOW_CONTENT);
    }
    const res = checkWorkflowShape({ repoRoot: root });
    expect(res.status).toBe('green');
  });

  it('is yellow when workflows are missing the codex-action step', () => {
    writeConfig(root, { execution_path: 'codex-cli' });
    for (const f of WORKFLOW_FILES) {
      writeWorkflow(root, f, MISSING_STEP_CONTENT);
    }
    const res = checkWorkflowShape({ repoRoot: root });
    expect(res.status).toBe('yellow');
    expect(res.detail).toContain('run-agent-codex-cli');
  });

  it('is red when no workflow file exists at all', () => {
    writeConfig(root, { execution_path: 'codex-cli' });
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    const res = checkWorkflowShape({ repoRoot: root });
    expect(res.status).toBe('red');
    expect(res.detail).toContain('no Ferry workflows found');
    expect(res.remedy).toContain('ferry-init');
  });

  it('is red when the workflows directory does not exist', () => {
    writeConfig(root, { execution_path: 'codex-cli' });
    const res = checkWorkflowShape({ repoRoot: root });
    expect(res.status).toBe('red');
    expect(res.detail).toContain('no Ferry workflows found');
  });
});
