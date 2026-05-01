import { describe, it, expect, vi, afterEach } from 'vitest';

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
  afterEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
  });

  it('returns skip when noDispatch is true', async () => {
    const result = await checkSyntheticDispatch({ repo: 'org/repo', noDispatch: true });
    expect(result.status).toBe('skip');
    expect(result.detail).toContain('--no-dispatch');
  });

  it('returns red for permission/403 error on trigger', async () => {
    mockExecSync.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string;
      if (cmd.includes('dispatches')) throw new Error('HTTP 403: permission denied');
      return '[]';
    });
    const result = await checkSyntheticDispatch({ repo: 'org/repo', noDispatch: false });
    expect(result.status).toBe('red');
    expect(result.detail).toContain('Permission denied');
  });

  it('returns red for not-found/404 error on trigger', async () => {
    mockExecSync.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string;
      if (cmd.includes('dispatches')) throw new Error('not found 404');
      return '[]';
    });
    const result = await checkSyntheticDispatch({ repo: 'org/repo', noDispatch: false });
    expect(result.status).toBe('red');
    expect(result.detail).toContain('not found or dispatch not allowed');
  });

  it('returns red for generic trigger error', async () => {
    mockExecSync.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string;
      if (cmd.includes('dispatches')) throw new Error('something went wrong');
      return '[]';
    });
    const result = await checkSyntheticDispatch({ repo: 'org/repo', noDispatch: false });
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

    const promise = checkSyntheticDispatch({ repo: 'org/repo', noDispatch: false });
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

    const promise = checkSyntheticDispatch({ repo: 'org/repo', noDispatch: false });
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

    const promise = checkSyntheticDispatch({ repo: 'org/repo', noDispatch: false });
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

    const promise = checkSyntheticDispatch({ repo: 'org/repo', noDispatch: false });
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

    const promise = checkSyntheticDispatch({ repo: 'org/repo', noDispatch: false });
    await vi.advanceTimersByTimeAsync(3001);
    await vi.advanceTimersByTimeAsync(6001);
    const result = await promise;

    expect(result.status).toBe('green');
  });
});
