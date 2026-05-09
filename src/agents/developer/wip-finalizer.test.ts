import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FerryError } from '../../lib/errors/index.js';
import { InMemoryTracker } from '../../lib/io/tracker/in-memory.js';
import { createTestLogger } from '../../lib/logger/index.js';

const { mockExecFileSync, mockAppendFileSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn<(cmd: string, args: string[], opts?: unknown) => Buffer | string>(),
  mockAppendFileSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

vi.mock('node:fs', () => ({
  appendFileSync: mockAppendFileSync,
}));

import { classifyError, runWipFinalizer } from './wip-finalizer.js';

function makeTracker(ticketKey: string): InMemoryTracker {
  const tracker = new InMemoryTracker();
  tracker.seed({
    key: ticketKey,
    summary: 'Test ticket',
    description: 'desc',
    comments: [],
    labels: [],
    issueType: 'Story',
    issueTypeRaw: 'Story',
  });
  return tracker;
}

function baseOpts(tracker: InMemoryTracker) {
  return {
    ticketKey: 'PROJ-1',
    eventId: 'ev-123',
    branchName: 'ferry/PROJ-1',
    repoRoot: '/repo',
    secretScan: async () => {},
    tracker,
    logger: createTestLogger('test', 'wip-test').logger,
    dryRun: false,
    model: 'claude-test',
    provider: 'anthropic',
  };
}

describe('classifyError', () => {
  it('classifies spend-cap with token counts', () => {
    const err = new FerryError('spend-cap', {
      reason: 'input-token-budget-exceeded',
      cap: 500_000,
      consumed: 520_000,
    });
    const { code, detail } = classifyError(err);
    expect(code).toBe('spend-cap');
    expect(detail).toContain('520,000');
    expect(detail).toContain('500,000');
  });

  it('classifies spend-cap without counts when context is missing', () => {
    const err = new FerryError('spend-cap', {});
    const { code, detail } = classifyError(err);
    expect(code).toBe('spend-cap');
    expect(detail).toBe('spend cap exceeded');
  });

  it('classifies iteration-cap-exceeded with cap value', () => {
    const err = new FerryError('state-invariant', {
      reason: 'iteration-cap-exceeded',
      cap: 200,
    });
    const { code, detail } = classifyError(err);
    expect(code).toBe('state-invariant');
    expect(detail).toContain('200');
    expect(detail).toMatch(/max iterations/i);
  });

  it('classifies other FerryErrors by reason', () => {
    const err = new FerryError('state-invariant', { reason: 'agent-stopped-without-done' });
    const { code, detail } = classifyError(err);
    expect(code).toBe('state-invariant');
    expect(detail).toBe('agent-stopped-without-done');
  });

  it('classifies non-FerryError by message', () => {
    const err = new Error('network timeout');
    const { code, detail } = classifyError(err);
    expect(code).toBe('unknown');
    expect(detail).toBe('network timeout');
  });

  it('truncates long non-FerryError messages to 200 chars', () => {
    const err = new Error('x'.repeat(300));
    const { detail } = classifyError(err);
    expect(detail).toHaveLength(200);
  });
});

describe('runWipFinalizer', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockAppendFileSync.mockReset();
    delete process.env.GITHUB_OUTPUT;
  });

  it('commits, pushes, and posts Jira comment on spend-cap failure', async () => {
    const tracker = makeTracker('PROJ-1');
    const error = new FerryError('spend-cap', {
      reason: 'input-token-budget-exceeded',
      cap: 500_000,
      consumed: 520_000,
    });

    mockExecFileSync.mockReturnValueOnce(''); // git add -A
    mockExecFileSync.mockReturnValueOnce('M foo'); // git status (has changes)
    mockExecFileSync.mockReturnValueOnce(''); // git commit
    mockExecFileSync.mockReturnValueOnce(''); // git push --force-with-lease

    await runWipFinalizer({ ...baseOpts(tracker), error });

    expect(tracker.postedComments).toHaveLength(1);
    const { key, body } = tracker.postedComments[0];
    expect(key).toBe('PROJ-1');
    expect(body).toContain('[ferry:dev:wip:ev-123]');
    expect(body).toContain('ferry/PROJ-1');
    expect(body).toContain('spend cap exceeded');
    expect(body).toContain('520,000');
  });

  it('skips commit when nothing to commit but still posts Jira comment', async () => {
    const tracker = makeTracker('PROJ-1');
    const error = new FerryError('state-invariant', {
      reason: 'iteration-cap-exceeded',
      cap: 200,
    });

    mockExecFileSync.mockReturnValueOnce(''); // git add -A
    mockExecFileSync.mockReturnValueOnce(''); // git status (empty)
    mockExecFileSync.mockReturnValueOnce(''); // git push --force-with-lease

    await runWipFinalizer({ ...baseOpts(tracker), error });

    const calls = mockExecFileSync.mock.calls as Array<[string, string[], unknown]>;
    const commitCall = calls.find(([, args]) => Array.isArray(args) && args[0] === 'commit');
    expect(commitCall).toBeUndefined();

    expect(tracker.postedComments).toHaveLength(1);
    expect(tracker.postedComments[0].body).toContain('max iterations reached');
    expect(tracker.postedComments[0].body).toContain('200');
  });

  it('skips push and Jira comment in dryRun mode', async () => {
    const tracker = makeTracker('PROJ-1');
    const error = new FerryError('spend-cap', { reason: 'budget', cap: 1, consumed: 2 });

    mockExecFileSync.mockReturnValueOnce(''); // git add -A
    mockExecFileSync.mockReturnValueOnce('M foo.ts'); // git status
    mockExecFileSync.mockReturnValueOnce(''); // git commit

    await runWipFinalizer({ ...baseOpts(tracker), error, dryRun: true });

    const calls = mockExecFileSync.mock.calls as Array<[string, string[], unknown]>;
    const pushCall = calls.find(([, args]) => Array.isArray(args) && args[0] === 'push');
    expect(pushCall).toBeUndefined();
    expect(tracker.postedComments).toHaveLength(0);
  });

  it('falls back to plain push when force-with-lease fails', async () => {
    const tracker = makeTracker('PROJ-1');
    const error = new FerryError('spend-cap', { cap: 1, consumed: 2 });

    mockExecFileSync.mockReturnValueOnce(''); // git add -A
    mockExecFileSync.mockReturnValueOnce(''); // git status (nothing to commit)
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('no upstream tracking reference');
    }); // git push --force-with-lease
    mockExecFileSync.mockReturnValueOnce(''); // git push (fallback)

    await runWipFinalizer({ ...baseOpts(tracker), error });

    const calls = mockExecFileSync.mock.calls as Array<[string, string[], unknown]>;
    const plainPush = calls.find(
      ([, args]) =>
        Array.isArray(args) && args[0] === 'push' && !args.includes('--force-with-lease'),
    );
    expect(plainPush).toBeDefined();
    expect(tracker.postedComments).toHaveLength(1);
    expect(tracker.postedComments[0].body).toContain('ferry/PROJ-1');
  });

  it('swallows Jira comment failure without rethrowing', async () => {
    const tracker = makeTracker('PROJ-1');
    vi.spyOn(tracker, 'postComment').mockRejectedValueOnce(new Error('Jira unreachable'));
    const error = new FerryError('spend-cap', { cap: 1, consumed: 2 });

    mockExecFileSync.mockReturnValueOnce(''); // git add -A
    mockExecFileSync.mockReturnValueOnce(''); // git status
    mockExecFileSync.mockReturnValueOnce(''); // git push --force-with-lease

    await expect(runWipFinalizer({ ...baseOpts(tracker), error })).resolves.toBeUndefined();
  });

  it('swallows git commit failure without rethrowing', async () => {
    const tracker = makeTracker('PROJ-1');
    const error = new FerryError('spend-cap', { cap: 1, consumed: 2 });

    mockExecFileSync.mockReturnValueOnce(''); // git add -A
    mockExecFileSync.mockReturnValueOnce('M foo'); // git status (has changes)
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('git commit failed: pre-commit hook rejected');
    }); // git commit fails
    // push is still attempted after commit failure
    mockExecFileSync.mockReturnValueOnce(''); // git push --force-with-lease

    await expect(runWipFinalizer({ ...baseOpts(tracker), error })).resolves.toBeUndefined();
    expect(tracker.postedComments).toHaveLength(1);
  });

  it('emits zeroed audit output via appendOutput', async () => {
    process.env.GITHUB_OUTPUT = '/tmp/ferry-test-output';
    const tracker = makeTracker('PROJ-1');
    const error = new FerryError('spend-cap', { cap: 1, consumed: 2 });

    mockExecFileSync.mockReturnValueOnce(''); // git add -A
    mockExecFileSync.mockReturnValueOnce(''); // git status
    mockExecFileSync.mockReturnValueOnce(''); // git push

    await runWipFinalizer({ ...baseOpts(tracker), error });

    expect(mockAppendFileSync).toHaveBeenCalledWith(
      '/tmp/ferry-test-output',
      expect.stringContaining('input_tokens=0'),
    );
    expect(mockAppendFileSync).toHaveBeenCalledWith(
      '/tmp/ferry-test-output',
      expect.stringContaining('output_tokens=0'),
    );
  });

  it('calls secretScan before committing', async () => {
    const tracker = makeTracker('PROJ-1');
    const secretScan = vi.fn().mockResolvedValue(undefined);
    const error = new FerryError('spend-cap', { cap: 1, consumed: 2 });

    mockExecFileSync.mockReturnValueOnce(''); // git add -A
    mockExecFileSync.mockReturnValueOnce('M foo'); // git status
    mockExecFileSync.mockReturnValueOnce(''); // git commit
    mockExecFileSync.mockReturnValueOnce(''); // git push

    await runWipFinalizer({ ...baseOpts(tracker), error, secretScan });

    expect(secretScan).toHaveBeenCalledOnce();
  });

  it('does not call secretScan when nothing to commit', async () => {
    const tracker = makeTracker('PROJ-1');
    const secretScan = vi.fn().mockResolvedValue(undefined);
    const error = new FerryError('spend-cap', { cap: 1, consumed: 2 });

    mockExecFileSync.mockReturnValueOnce(''); // git add -A
    mockExecFileSync.mockReturnValueOnce(''); // git status (empty)
    mockExecFileSync.mockReturnValueOnce(''); // git push

    await runWipFinalizer({ ...baseOpts(tracker), error, secretScan });

    expect(secretScan).not.toHaveBeenCalled();
  });
});
