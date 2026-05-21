import { describe, expect, it } from 'vitest';

import { mapCheckRunsToStatus, type CheckRun } from './ci-gate-action.js';

/**
 * Unit tests for the pure check-runs → CiStatus mapping used by the reviewer
 * CI pre-gate. The IO shell (Octokit, GITHUB_OUTPUT) is intentionally not
 * exercised here — only the deterministic mapping is.
 */
describe('mapCheckRunsToStatus', () => {
  const completed = (conclusion: string): CheckRun => ({ status: 'completed', conclusion });

  it('returns pending when there are no check-runs', () => {
    expect(mapCheckRunsToStatus([])).toBe('pending');
  });

  it('returns pending when any check-run is still in progress', () => {
    const runs: CheckRun[] = [completed('success'), { status: 'in_progress', conclusion: null }];
    expect(mapCheckRunsToStatus(runs)).toBe('pending');
  });

  it('returns pending when a check-run is queued', () => {
    expect(mapCheckRunsToStatus([{ status: 'queued', conclusion: null }])).toBe('pending');
  });

  it('returns green when every completed check-run succeeded', () => {
    expect(mapCheckRunsToStatus([completed('success'), completed('success')])).toBe('green');
  });

  it('treats neutral and skipped conclusions as non-blocking (green)', () => {
    expect(
      mapCheckRunsToStatus([completed('success'), completed('neutral'), completed('skipped')]),
    ).toBe('green');
  });

  it('returns red when any completed check-run failed', () => {
    expect(mapCheckRunsToStatus([completed('success'), completed('failure')])).toBe('red');
  });

  it('treats timed_out as red', () => {
    expect(mapCheckRunsToStatus([completed('timed_out')])).toBe('red');
  });

  it('treats cancelled as red', () => {
    expect(mapCheckRunsToStatus([completed('cancelled')])).toBe('red');
  });

  it('treats action_required as red', () => {
    expect(mapCheckRunsToStatus([completed('action_required')])).toBe('red');
  });

  it('prioritises pending over red when both an unfinished and a failed run exist', () => {
    const runs: CheckRun[] = [completed('failure'), { status: 'in_progress', conclusion: null }];
    expect(mapCheckRunsToStatus(runs)).toBe('pending');
  });
});
