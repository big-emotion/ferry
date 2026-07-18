import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mockExecSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execSync: mockExecSync,
}));

import { checkSyntheticDispatch } from './dispatch.js';

interface MockRun {
  databaseId: number;
  status: string;
  conclusion: string | null;
  url: string;
  headBranch: string;
  event: string;
}

function makeRun(overrides: Partial<MockRun> = {}): MockRun {
  return {
    databaseId: 100,
    status: 'in_progress',
    conclusion: null,
    url: 'https://github.com/org/repo/actions/runs/100',
    headBranch: 'main',
    event: 'repository_dispatch',
    ...overrides,
  };
}

describe('checkSyntheticDispatch', () => {
  // Legacy install by default: no ferry-router.yml under repoRoot.
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'ferry-doctor-dispatch-'));
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  function installRouterWorkflow(): void {
    const workflowDir = join(repoRoot, '.github', 'workflows');
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(join(workflowDir, 'ferry-router.yml'), 'name: Ferry — Router\n');
  }

  it('returns skip when noDispatch is true', async () => {
    const result = await checkSyntheticDispatch({ repo: 'org/repo', repoRoot, noDispatch: true });
    expect(result.status).toBe('skip');
    expect(result.detail).toContain('--no-dispatch');
  });

  it('returns red for permission/403 error on trigger', async () => {
    mockExecSync.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string;
      if (cmd.includes('dispatches')) throw new Error('HTTP 403: permission denied');
      return '[]';
    });
    const result = await checkSyntheticDispatch({ repo: 'org/repo', repoRoot, noDispatch: false });
    expect(result.status).toBe('red');
    expect(result.detail).toContain('Permission denied');
  });

  it('returns red for not-found/404 error on trigger', async () => {
    mockExecSync.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string;
      if (cmd.includes('dispatches')) throw new Error('not found 404');
      return '[]';
    });
    const result = await checkSyntheticDispatch({ repo: 'org/repo', repoRoot, noDispatch: false });
    expect(result.status).toBe('red');
    expect(result.detail).toContain('not found or dispatch not allowed');
  });

  it('returns red for generic trigger error', async () => {
    mockExecSync.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string;
      if (cmd.includes('dispatches')) throw new Error('something went wrong');
      return '[]';
    });
    const result = await checkSyntheticDispatch({ repo: 'org/repo', repoRoot, noDispatch: false });
    expect(result.status).toBe('red');
    expect(result.detail).toContain('Dispatch failed');
  });

  it('returns green for in_progress run', async () => {
    vi.useFakeTimers();
    const run = makeRun({ status: 'in_progress' });
    let listCount = 0;
    mockExecSync.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string;
      if (cmd.includes('dispatches')) return '';
      listCount++;
      if (listCount === 1) return '[]'; // baseline
      return JSON.stringify([run]);
    });

    const promise = checkSyntheticDispatch({ repo: 'org/repo', repoRoot, noDispatch: false });
    await vi.advanceTimersByTimeAsync(3001); // first poll sleep
    await vi.advanceTimersByTimeAsync(6001); // post-find sleep
    const result = await promise;

    expect(result.status).toBe('green');
    expect(result.detail).toContain('100');
  });

  it('returns green for queued run', async () => {
    vi.useFakeTimers();
    const run = makeRun({ databaseId: 200, status: 'queued' });
    let listCount = 0;
    mockExecSync.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string;
      if (cmd.includes('dispatches')) return '';
      listCount++;
      if (listCount === 1) return '[]';
      return JSON.stringify([run]);
    });

    const promise = checkSyntheticDispatch({ repo: 'org/repo', repoRoot, noDispatch: false });
    await vi.advanceTimersByTimeAsync(3001);
    await vi.advanceTimersByTimeAsync(6001);
    const result = await promise;

    expect(result.status).toBe('green');
  });

  it('returns yellow for completed failure run (gate step expected)', async () => {
    vi.useFakeTimers();
    const run = makeRun({ status: 'completed', conclusion: 'failure' });
    let listCount = 0;
    mockExecSync.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string;
      if (cmd.includes('dispatches')) return '';
      listCount++;
      if (listCount === 1) return '[]';
      return JSON.stringify([run]);
    });

    const promise = checkSyntheticDispatch({ repo: 'org/repo', repoRoot, noDispatch: false });
    await vi.advanceTimersByTimeAsync(3001);
    await vi.advanceTimersByTimeAsync(6001);
    const result = await promise;

    expect(result.status).toBe('yellow');
    expect(result.detail).toContain('gate step');
  });

  it('returns yellow when no run appears within the 45s timeout', async () => {
    vi.useFakeTimers();
    mockExecSync.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string;
      if (cmd.includes('dispatches')) return '';
      return '[]'; // polls always return empty
    });

    const promise = checkSyntheticDispatch({ repo: 'org/repo', repoRoot, noDispatch: false });
    // Advance past the full polling window (15 × 3s = 45s, plus some buffer)
    await vi.advanceTimersByTimeAsync(50000);
    const result = await promise;

    expect(result.status).toBe('yellow');
    expect(result.detail).toContain('45 s');
  });

  it('handles completed run with non-failure conclusion as green', async () => {
    vi.useFakeTimers();
    const run = makeRun({ status: 'completed', conclusion: 'success' });
    let listCount = 0;
    mockExecSync.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string;
      if (cmd.includes('dispatches')) return '';
      listCount++;
      if (listCount === 1) return '[]';
      return JSON.stringify([run]);
    });

    const promise = checkSyntheticDispatch({ repo: 'org/repo', repoRoot, noDispatch: false });
    await vi.advanceTimersByTimeAsync(3001);
    await vi.advanceTimersByTimeAsync(6001);
    const result = await promise;

    expect(result.status).toBe('green');
  });

  it('polls ferry-refine.yml on a legacy install (no ferry-router.yml)', async () => {
    vi.useFakeTimers();
    mockExecSync.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string;
      if (cmd.includes('dispatches')) return '';
      return '[]';
    });

    const promise = checkSyntheticDispatch({ repo: 'org/repo', repoRoot, noDispatch: false });
    await vi.advanceTimersByTimeAsync(50000);
    const result = await promise;

    const runListCalls = mockExecSync.mock.calls
      .map((c) => c[0] as string)
      .filter((cmd) => cmd.includes('gh run list'));
    expect(runListCalls.length).toBeGreaterThan(0);
    for (const cmd of runListCalls) {
      expect(cmd).toContain('--workflow ferry-refine.yml');
    }
    expect(result.remedy).toContain('ferry-refine.yml');
  });

  it('polls ferry-router.yml when the router workflow is installed', async () => {
    installRouterWorkflow();
    vi.useFakeTimers();
    mockExecSync.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string;
      if (cmd.includes('dispatches')) return '';
      return '[]';
    });

    const promise = checkSyntheticDispatch({ repo: 'org/repo', repoRoot, noDispatch: false });
    await vi.advanceTimersByTimeAsync(50000);
    const result = await promise;

    const runListCalls = mockExecSync.mock.calls
      .map((c) => c[0] as string)
      .filter((cmd) => cmd.includes('gh run list'));
    expect(runListCalls.length).toBeGreaterThan(0);
    for (const cmd of runListCalls) {
      expect(cmd).toContain('--workflow ferry-router.yml');
    }
    // The probe event type stays ferry-refine — the router listens for legacy
    // events, and a legacy install only understands the per-agent types. The
    // payload travels via the exec `input` option (gh api --input -).
    const dispatchCall = mockExecSync.mock.calls.find((c) =>
      (c[0] as string).includes('dispatches'),
    );
    expect(dispatchCall).toBeDefined();
    const execOptions = dispatchCall?.[1] as { input?: string } | undefined;
    expect(execOptions?.input).toContain('"event_type":"ferry-refine"');
    expect(result.remedy).toContain('ferry-router.yml');
  });

  it('names ferry-router.yml in the not-found remedy on a router install', async () => {
    installRouterWorkflow();
    mockExecSync.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string;
      if (cmd.includes('dispatches')) throw new Error('not found 404');
      return '[]';
    });
    const result = await checkSyntheticDispatch({ repo: 'org/repo', repoRoot, noDispatch: false });
    expect(result.status).toBe('red');
    expect(result.remedy).toContain('ferry-router.yml');
  });
});
