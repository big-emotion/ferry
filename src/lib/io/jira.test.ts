import { describe, it, expect, vi, beforeEach } from 'vitest';
// --- module mocks (hoisted before any imports) ---

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../safety/scan.js', () => ({
  scanWithGitleaks: vi.fn().mockResolvedValue({ leaksFound: false, findings: [] }),
}));

vi.mock('./jira-rest.js', () => {
  const mockClient = {
    getIssue: vi.fn(),
    postComment: vi.fn().mockResolvedValue({ id: '10002', body: {} }),
    putComment: vi.fn().mockResolvedValue({ id: '10001', body: {} }),
    createSubtask: vi.fn().mockResolvedValue({ id: '10003', key: 'ACME-2', self: '' }),
    addLabel: vi.fn().mockResolvedValue(undefined),
    getTransitions: vi.fn(),
    postTransition: vi.fn().mockResolvedValue(undefined),
  };
  return {
    JiraRestClient: vi.fn().mockReturnValue(mockClient),
    createJiraRestClientFromEnv: vi.fn().mockReturnValue(mockClient),
  };
});

// --- imports after mocks ---

import { scanWithGitleaks } from '../safety/scan.js';
import { createJiraRestClientFromEnv } from './jira-rest.js';
import { postComment } from './jira.js';

function getMockClient() {
  return vi.mocked(createJiraRestClientFromEnv).mock.results.at(-1)?.value as {
    getIssue: ReturnType<typeof vi.fn>;
    postComment: ReturnType<typeof vi.fn>;
    putComment: ReturnType<typeof vi.fn>;
    createSubtask: ReturnType<typeof vi.fn>;
    addLabel: ReturnType<typeof vi.fn>;
    getTransitions: ReturnType<typeof vi.fn>;
    postTransition: ReturnType<typeof vi.fn>;
  };
}

describe('io/jira — secret-scan gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(scanWithGitleaks).mockResolvedValue({ leaksFound: false, findings: [] });
  });

  describe('postComment', () => {
    it('calls scanWithGitleaks before posting the comment', async () => {
      vi.mocked(createJiraRestClientFromEnv).mockReturnValue({
        getIssue: vi.fn(),
        postComment: vi.fn().mockResolvedValue({ id: '10002', body: {} }),
        putComment: vi.fn(),
        createSubtask: vi.fn(),
        addLabel: vi.fn(),
        getTransitions: vi.fn(),
        postTransition: vi.fn(),
      } as unknown as ReturnType<typeof createJiraRestClientFromEnv>);

      await postComment({
        ticketKey: 'ACME-1',
        body: 'hello world',
        idempotencyMarker: '[ferry:developer:run-1]',
        recentComments: [],
      });

      expect(vi.mocked(scanWithGitleaks)).toHaveBeenCalledOnce();
      const c = getMockClient();
      expect(c.postComment).toHaveBeenCalledOnce();
    });

    it('throws FerryError("spend-cap") with reason "secret-scan-hit" when a leak is found', async () => {
      vi.mocked(scanWithGitleaks).mockResolvedValue({
        leaksFound: true,
        findings: [
          { ruleId: 'generic-api-key', description: 'API key', file: '', startLine: 1, endLine: 1 },
        ],
      });
      vi.mocked(createJiraRestClientFromEnv).mockReturnValue({
        getIssue: vi.fn(),
        postComment: vi.fn(),
        putComment: vi.fn(),
        createSubtask: vi.fn(),
        addLabel: vi.fn(),
        getTransitions: vi.fn(),
        postTransition: vi.fn(),
      } as unknown as ReturnType<typeof createJiraRestClientFromEnv>);

      await expect(
        postComment({
          ticketKey: 'ACME-1',
          body: 'AKIAIOSFODNN7EXAMPLE secret payload',
          idempotencyMarker: '[ferry:developer:run-1]',
          recentComments: [],
        }),
      ).rejects.toMatchObject({
        code: 'spend-cap',
        context: { reason: 'secret-scan-hit' },
      });
    });

    it('does NOT call jira-rest when scan detects a leak', async () => {
      vi.mocked(scanWithGitleaks).mockResolvedValue({
        leaksFound: true,
        findings: [{ ruleId: 'r', description: 'd', file: '', startLine: 1, endLine: 1 }],
      });
      const mockClient = {
        getIssue: vi.fn(),
        postComment: vi.fn(),
        putComment: vi.fn(),
        createSubtask: vi.fn(),
        addLabel: vi.fn(),
        getTransitions: vi.fn(),
        postTransition: vi.fn(),
      };
      vi.mocked(createJiraRestClientFromEnv).mockReturnValue(
        mockClient as unknown as ReturnType<typeof createJiraRestClientFromEnv>,
      );

      await expect(
        postComment({
          ticketKey: 'ACME-1',
          body: 'secret payload',
          idempotencyMarker: '[ferry:developer:run-1]',
          recentComments: [],
        }),
      ).rejects.toMatchObject({ code: 'spend-cap' });

      expect(mockClient.postComment).not.toHaveBeenCalled();
      expect(mockClient.putComment).not.toHaveBeenCalled();
    });

    it('skips immediately when idempotency marker is already present', async () => {
      const result = await postComment({
        ticketKey: 'ACME-1',
        body: 'hello',
        idempotencyMarker: '[ferry:developer:run-1]',
        recentComments: [{ id: 1, body: 'existing [ferry:developer:run-1] text' }],
      });
      expect(result.skipped).toBe(true);
      expect(vi.mocked(scanWithGitleaks)).not.toHaveBeenCalled();
    });
  });
});
