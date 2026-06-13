import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPollJql, fetchPollIssues, runPollOnce } from './poll.js';

const { processLocalTransition, loadFerryConfig, fetchMock } = vi.hoisted(() => ({
  processLocalTransition: vi.fn(),
  loadFerryConfig: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock('./process.js', () => ({
  processLocalTransition,
}));

vi.mock('../../lib/config.js', async () => {
  const actual = await vi.importActual<typeof import('../../lib/config.js')>('../../lib/config.js');
  return {
    ...actual,
    loadFerryConfig,
  };
});

describe('poll', () => {
  beforeEach(() => {
    processLocalTransition.mockReset();
    loadFerryConfig.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    loadFerryConfig.mockReturnValue({
      workflow: {
        agents: {
          refiner: { trigger_column: 'Refinement', auto_transition: null },
          developer: { trigger_column: 'In Development', auto_transition: 'In Review' },
          reviewer: {
            trigger_column: 'In Review',
            auto_transition_approve: null,
            auto_transition_changes: 'Changes Requested',
          },
          iterator: { trigger_column: 'Changes Requested', auto_transition: 'In Review' },
        },
      },
    });
    vi.stubEnv('FERRY_JIRA_BASE_URL', 'https://jira.example.com');
    vi.stubEnv('FERRY_JIRA_EMAIL', 'robot@example.com');
    vi.stubEnv('FERRY_JIRA_API_TOKEN', 'token');
  });

  it('builds a JQL clause for the configured statuses', () => {
    expect(buildPollJql(['Refinement', 'In Development'])).toBe(
      'status in ("Refinement","In Development") ORDER BY updated DESC',
    );
  });

  it('fetches Jira issues from the configured workflow columns', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        issues: [
          {
            id: '1001',
            key: 'CHAN-1',
            fields: {
              status: { name: 'In Development' },
              updated: '2026-06-13T09:10:11.000Z',
            },
          },
        ],
      }),
    });

    const issues = await fetchPollIssues('/repo');

    expect(issues).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/rest/api/3/search?jql='),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Basic /),
        }),
      }),
    );
  });

  it('processes each issue through the local transition handler', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        issues: [
          {
            id: '1001',
            key: 'CHAN-1',
            fields: {
              status: { name: 'In Development' },
              updated: '2026-06-13T09:10:11.000Z',
            },
          },
        ],
      }),
    });

    await runPollOnce({ repoRoot: '/repo', dryRun: true });

    expect(processLocalTransition).toHaveBeenCalledWith({
      repoRoot: '/repo',
      ticketKey: 'CHAN-1',
      status: 'In Development',
      ts: '2026-06-13T09:10:11.000Z',
      eventId: `${Date.parse('2026-06-13T09:10:11.000Z')}-CHAN-1`,
      dryRun: true,
    });
  });
});
