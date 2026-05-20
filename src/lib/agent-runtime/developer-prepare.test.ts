import { describe, it, expect, vi, afterEach } from 'vitest';
import { prepareDeveloper, type BranchCheckoutResult } from './developer-prepare.js';
import { createLogger } from '../logger/index.js';
import type { TrackerIssue } from '../io/tracker/types.js';
import type { CIRunner } from '../dispatch/runner/types.js';
import type { FerryConfig } from '../config.js';
import type { EventEnvelopeV1 } from '../envelope/types.js';
import type { McpServerConfig } from '../llm/agent-loop/types.js';

const REPO_ROOT = '/workspace/repo';

const envelope: EventEnvelopeV1 = {
  version: 'v1',
  event_id: 'evt-dev-001',
  ticket_key: 'PROJ-400',
  phase: 'dev',
  source: 'jira-column',
  ts: '2026-01-01T00:00:00Z',
};

const issue: TrackerIssue = {
  key: 'PROJ-400',
  summary: 'Implement signup',
  description: 'AC: signup endpoint',
  comments: ['First comment', 'Second comment'],
  labels: ['ferry:dev'],
  issueType: 'Story',
  issueTypeRaw: 'Story',
};

const effectiveCfg = {
  models: { dev: { provider: 'anthropic', model: 'claude-opus-4-7' } },
  git: { working_branch_prefix: 'ferry/feat/' },
  labels: undefined,
} as unknown as FerryConfig;

const mcpPool: McpServerConfig[] = [{ name: 'context7', url: 'https://example.com' }];

afterEach(() => {
  vi.restoreAllMocks();
});

function makeRunner(overrides: Partial<CIRunner> = {}): CIRunner {
  return {
    listPRsForBranch: vi.fn().mockResolvedValue([]),
    listPRFiles: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as CIRunner;
}

function buildSystemStub(name: string, _root: string, opts?: { extraParts?: unknown[] }) {
  return `SYSTEM(${name}, parts=${(opts?.extraParts ?? []).length})`;
}

describe('prepareDeveloper', () => {
  it('builds system, ticket block, initial prompt, idempotency marker and capability-filtered MCP pool', async () => {
    const checkoutOrCreateBranch = vi.fn(
      (): BranchCheckoutResult => ({ branchHeadSha: '', existingLog: '' }),
    );
    const ctx = await prepareDeveloper({
      envelope,
      issue,
      effectiveCfg,
      subtasks: ['Step one', 'Step two'],
      testRunner: 'vitest',
      pkgManagerHint: 'npm',
      tree: 'src/\n  index.ts',
      typeOverride: undefined,
      owner: 'big-emotion',
      repo: 'ferry',
      baseBranch: 'main',
      runner: makeRunner(),
      mcpPool,
      repoRoot: REPO_ROOT,
      dryRun: false,
      logger: createLogger('evt-dev-001', 'test'),
      _buildSystem: buildSystemStub,
      _checkoutOrCreateBranch: checkoutOrCreateBranch,
      _configureGitUser: () => {},
    });

    expect(ctx.system).toBe('SYSTEM(dev, parts=1)');
    expect(ctx.branchName).toBe('ferry/feat/PROJ-400');
    expect(ctx.branchHeadSha).toBe('');
    // No existing branch → idempotency falls back to event_id
    expect(ctx.idempotencyMarker).toBe('[ferry:dev:evt-dev-001]');
    expect(ctx.existingPrUrl).toBe('');
    expect(ctx.ticketBlock).toContain('TICKET: PROJ-400');
    expect(ctx.ticketBlock).toContain('LABELS: ferry:dev');
    expect(ctx.initialPrompt).toContain('TICKET: PROJ-400');
    expect(ctx.initialPrompt).toContain('SUBTASKS:\nStep one\nStep two');
    expect(ctx.initialPrompt).toContain('TEST_RUNNER: vitest');
    expect(ctx.initialPrompt).toContain('REPO TREE (depth 2):\nsrc/\n  index.ts');
    expect(ctx.initialPrompt).toContain(
      'When you have finished implementing, call the `done` tool.',
    );
    expect(checkoutOrCreateBranch).toHaveBeenCalledWith(
      'ferry/feat/PROJ-400',
      'main',
      REPO_ROOT,
      expect.any(Object),
    );
  });

  it('uses "SUBTASKS: (none)" when there are no subtasks', async () => {
    const ctx = await prepareDeveloper({
      envelope,
      issue,
      effectiveCfg,
      subtasks: [],
      testRunner: 'vitest',
      pkgManagerHint: undefined,
      tree: '(unavailable)',
      typeOverride: undefined,
      owner: 'o',
      repo: 'r',
      baseBranch: 'main',
      runner: makeRunner(),
      mcpPool,
      repoRoot: REPO_ROOT,
      dryRun: false,
      logger: createLogger('evt', 'test'),
      _buildSystem: buildSystemStub,
      _checkoutOrCreateBranch: () => ({ branchHeadSha: '', existingLog: '' }),
      _configureGitUser: () => {},
    });

    expect(ctx.initialPrompt).toContain('SUBTASKS: (none)');
    // No pkgManagerHint → no extra part
    expect(ctx.system).toBe('SYSTEM(dev, parts=0)');
  });

  it('keys the idempotency marker on the branch head SHA when the branch already exists', async () => {
    const ctx = await prepareDeveloper({
      envelope,
      issue,
      effectiveCfg,
      subtasks: [],
      testRunner: 'vitest',
      pkgManagerHint: 'npm',
      tree: '',
      typeOverride: undefined,
      owner: 'o',
      repo: 'r',
      baseBranch: 'main',
      runner: makeRunner(),
      mcpPool,
      repoRoot: REPO_ROOT,
      dryRun: false,
      logger: createLogger('evt', 'test'),
      _buildSystem: buildSystemStub,
      _checkoutOrCreateBranch: () => ({
        branchHeadSha: 'abcdef1234567890',
        existingLog: 'aaa1111 prior work',
      }),
      _configureGitUser: () => {},
    });

    expect(ctx.branchHeadSha).toBe('abcdef1234567890');
    expect(ctx.idempotencyMarker).toBe('[ferry:dev:abcdef1]');
    expect(ctx.initialPrompt).toContain(
      'EXISTING WORK ON BRANCH (already committed — skip these, only do what remains):\naaa1111 prior work',
    );
  });

  it('injects an existing-PR context section when an open Ferry PR is found on the branch', async () => {
    const listPRsForBranch = vi.fn().mockResolvedValue([{ number: 99 }]);
    const listPRFiles = vi.fn().mockResolvedValue([
      { filename: 'src/foo.ts', status: 'modified' },
      { filename: 'src/bar.ts', status: 'added' },
    ]);
    const runner = makeRunner({ listPRsForBranch, listPRFiles });

    const ctx = await prepareDeveloper({
      envelope,
      issue,
      effectiveCfg,
      subtasks: [],
      testRunner: 'vitest',
      pkgManagerHint: 'npm',
      tree: '',
      typeOverride: undefined,
      owner: 'big-emotion',
      repo: 'ferry',
      baseBranch: 'main',
      runner,
      mcpPool,
      repoRoot: REPO_ROOT,
      dryRun: false,
      logger: createLogger('evt', 'test'),
      _buildSystem: buildSystemStub,
      _checkoutOrCreateBranch: () => ({ branchHeadSha: 'abcdef1234567890', existingLog: '' }),
      _configureGitUser: () => {},
    });

    expect(ctx.existingPrUrl).toBe('https://github.com/big-emotion/ferry/pull/99');
    expect(ctx.initialPrompt).toContain('EXISTING_IMPLEMENTATION:');
    expect(ctx.initialPrompt).toContain('Open PR: https://github.com/big-emotion/ferry/pull/99');
    expect(ctx.initialPrompt).toContain('Changed files:\nmodified: src/foo.ts\nadded: src/bar.ts');
    expect(listPRsForBranch).toHaveBeenCalledWith('big-emotion', 'ferry', 'ferry/feat/PROJ-400');
  });

  it('skips the PR probe under dryRun, even when a branch head SHA is known', async () => {
    const listPRsForBranch = vi.fn().mockResolvedValue([{ number: 99 }]);
    const runner = makeRunner({ listPRsForBranch });

    const ctx = await prepareDeveloper({
      envelope,
      issue,
      effectiveCfg,
      subtasks: [],
      testRunner: 'vitest',
      pkgManagerHint: undefined,
      tree: '',
      typeOverride: undefined,
      owner: 'o',
      repo: 'r',
      baseBranch: 'main',
      runner,
      mcpPool,
      repoRoot: REPO_ROOT,
      dryRun: true,
      logger: createLogger('evt', 'test'),
      _buildSystem: buildSystemStub,
      _checkoutOrCreateBranch: () => ({ branchHeadSha: 'sha1234567890', existingLog: '' }),
      _configureGitUser: () => {},
    });

    expect(listPRsForBranch).not.toHaveBeenCalled();
    expect(ctx.existingPrUrl).toBe('');
    expect(ctx.initialPrompt).not.toContain('EXISTING_IMPLEMENTATION:');
  });

  it('treats PR-probe failures as best-effort and continues with empty existingPrContext', async () => {
    const listPRsForBranch = vi.fn().mockRejectedValue(new Error('GitHub 5xx'));
    const runner = makeRunner({ listPRsForBranch });

    const ctx = await prepareDeveloper({
      envelope,
      issue,
      effectiveCfg,
      subtasks: [],
      testRunner: 'vitest',
      pkgManagerHint: undefined,
      tree: '',
      typeOverride: undefined,
      owner: 'o',
      repo: 'r',
      baseBranch: 'main',
      runner,
      mcpPool,
      repoRoot: REPO_ROOT,
      dryRun: false,
      logger: createLogger('evt', 'test'),
      _buildSystem: buildSystemStub,
      _checkoutOrCreateBranch: () => ({ branchHeadSha: 'sha1234567890', existingLog: '' }),
      _configureGitUser: () => {},
    });

    expect(ctx.existingPrUrl).toBe('');
    expect(ctx.initialPrompt).not.toContain('EXISTING_IMPLEMENTATION:');
  });

  it('filters the MCP pool down to capability-triggered servers when labels config is provided', async () => {
    const cfgWithLabels = {
      ...effectiveCfg,
      labels: {
        'ferry:docs': { mcp_servers: ['context7'] },
      },
    } as unknown as FerryConfig;
    const issueWithLabel: TrackerIssue = {
      ...issue,
      labels: ['ferry:docs'],
    };
    const richMcpPool: McpServerConfig[] = [
      { name: 'context7', url: 'https://example.com/c7' },
      { name: 'jira', url: 'https://example.com/jira' },
    ];

    const ctx = await prepareDeveloper({
      envelope,
      issue: issueWithLabel,
      effectiveCfg: cfgWithLabels,
      subtasks: [],
      testRunner: 'vitest',
      pkgManagerHint: undefined,
      tree: '',
      typeOverride: undefined,
      owner: 'o',
      repo: 'r',
      baseBranch: 'main',
      runner: makeRunner(),
      mcpPool: richMcpPool,
      repoRoot: REPO_ROOT,
      dryRun: false,
      logger: createLogger('evt', 'test'),
      _buildSystem: buildSystemStub,
      _checkoutOrCreateBranch: () => ({ branchHeadSha: '', existingLog: '' }),
      _configureGitUser: () => {},
    });

    // Only context7 should remain — jira is not enabled by the ferry:docs label.
    expect(ctx.mcpServers.map((s) => s.name)).toEqual(['context7']);
  });

  it('invokes _configureGitUser exactly once', async () => {
    const configureSpy = vi.fn();
    await prepareDeveloper({
      envelope,
      issue,
      effectiveCfg,
      subtasks: [],
      testRunner: 'vitest',
      pkgManagerHint: undefined,
      tree: '',
      typeOverride: undefined,
      owner: 'o',
      repo: 'r',
      baseBranch: 'main',
      runner: makeRunner(),
      mcpPool,
      repoRoot: REPO_ROOT,
      dryRun: false,
      logger: createLogger('evt', 'test'),
      _buildSystem: buildSystemStub,
      _checkoutOrCreateBranch: () => ({ branchHeadSha: '', existingLog: '' }),
      _configureGitUser: configureSpy,
    });

    expect(configureSpy).toHaveBeenCalledTimes(1);
    expect(configureSpy).toHaveBeenCalledWith(REPO_ROOT);
  });
});
