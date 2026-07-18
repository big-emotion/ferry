import { describe, expect, it, vi, afterEach } from 'vitest';

import {
  mapCheckRunsToStatus,
  resolveChangesTransitionId,
  type CheckRun,
} from './ci-gate-action.js';

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

describe('resolveChangesTransitionId (FR24 auto-resolution)', () => {
  const JIRA_ENV = {
    FERRY_JIRA_BASE_URL: 'https://acme.atlassian.net',
    FERRY_JIRA_EMAIL: 'bot@acme.com',
    FERRY_JIRA_API_TOKEN: 'token',
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns the explicit FERRY_ITER_TRANSITION_ID without any IO', async () => {
    vi.stubEnv('FERRY_ITER_TRANSITION_ID', '42');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(resolveChangesTransitionId('PROJ-1')).resolves.toBe('42');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns empty (transition skipped) when no override and no Jira creds', async () => {
    await expect(resolveChangesTransitionId('PROJ-1')).resolves.toBe('');
  });

  it('auto-resolves the reviewer changes status name via the Jira transitions API', async () => {
    for (const [k, v] of Object.entries(JIRA_ENV)) vi.stubEnv(k, v);
    // Default config: auto_transition_changes = 'Changes Requested'.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: () =>
          Promise.resolve({
            transitions: [
              { id: '3', name: 'IN REVIEW', to: { name: 'In Review' } },
              { id: '5', name: 'REQUEST CHANGES', to: { name: 'Changes Requested' } },
            ],
          }),
      } as unknown as Response),
    );
    await expect(resolveChangesTransitionId('PROJ-1')).resolves.toBe('5');
  });

  it('is non-fatal when resolution fails — returns empty instead of throwing', async () => {
    for (const [k, v] of Object.entries(JIRA_ENV)) vi.stubEnv(k, v);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(resolveChangesTransitionId('PROJ-1')).resolves.toBe('');
  });
});
