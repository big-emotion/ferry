import { describe, it, expect, vi, beforeEach } from 'vitest';
// --- module mocks (hoisted before any imports) ---

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../secret-scan/scan.js', () => ({
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

import { scanWithGitleaks } from '../secret-scan/scan.js';
import { createJiraRestClientFromEnv } from './jira-rest.js';
import { postComment, getTicket, createSubtask, addLabel, transitionTicket } from './jira.js';

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

const ISSUE_FIXTURE = {
  id: '10001',
  key: 'ACME-1',
  fields: {
    summary: 'Implement feature X',
    description: {
      version: 1,
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ticket description.' }] }],
    },
    comment: {
      comments: [
        {
          id: '10001',
          body: {
            version: 1,
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: '[ferry:refiner:run-abc] refiner note' }],
              },
            ],
          },
        },
      ],
    },
    labels: ['feature', 'backend'],
    issuetype: { name: 'Story' },
  },
};

const TRANSITIONS_FIXTURE = {
  transitions: [
    { id: '11', name: 'To Do' },
    { id: '31', name: 'In Review' },
  ],
};

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

  describe('getTicket', () => {
    it('converts Jira issue response to JiraTicket with text bodies', async () => {
      vi.mocked(createJiraRestClientFromEnv).mockReturnValue({
        getIssue: vi.fn().mockResolvedValue(ISSUE_FIXTURE),
        postComment: vi.fn(),
        putComment: vi.fn(),
        createSubtask: vi.fn(),
        addLabel: vi.fn(),
        getTransitions: vi.fn(),
        postTransition: vi.fn(),
      } as unknown as ReturnType<typeof createJiraRestClientFromEnv>);

      const ticket = await getTicket('ACME-1');

      expect(ticket.key).toBe('ACME-1');
      expect(ticket.title).toBe('Implement feature X');
      expect(ticket.description).toBe('Ticket description.');
      expect(ticket.labels).toEqual(['feature', 'backend']);
      expect(ticket.issueType).toBe('Story');
      expect(ticket.comments).toHaveLength(1);
      expect(ticket.comments[0].id).toBe(10001);
      expect(ticket.comments[0].body).toContain('[ferry:refiner:run-abc]');
    });
  });

  describe('createSubtask', () => {
    it('scans the payload before creating the subtask', async () => {
      vi.mocked(createJiraRestClientFromEnv).mockReturnValue({
        getIssue: vi.fn(),
        postComment: vi.fn(),
        putComment: vi.fn(),
        createSubtask: vi.fn().mockResolvedValue({ id: '10003', key: 'ACME-2', self: '' }),
        addLabel: vi.fn(),
        getTransitions: vi.fn(),
        postTransition: vi.fn(),
      } as unknown as ReturnType<typeof createJiraRestClientFromEnv>);

      await createSubtask('ACME-1', 'Sub-task title', 'Description text');

      expect(vi.mocked(scanWithGitleaks)).toHaveBeenCalledOnce();
    });

    it('throws FerryError("spend-cap") with reason "secret-scan-hit" on leak', async () => {
      vi.mocked(scanWithGitleaks).mockResolvedValue({
        leaksFound: true,
        findings: [{ ruleId: 'r', description: 'd', file: '', startLine: 1, endLine: 1 }],
      });

      await expect(createSubtask('ACME-1', 'title', 'AKIAIOSFODNN7EXAMPLE')).rejects.toMatchObject({
        code: 'spend-cap',
        context: { reason: 'secret-scan-hit' },
      });
    });
  });

  describe('addLabel', () => {
    it('scans the label before adding', async () => {
      vi.mocked(createJiraRestClientFromEnv).mockReturnValue({
        getIssue: vi.fn(),
        postComment: vi.fn(),
        putComment: vi.fn(),
        createSubtask: vi.fn(),
        addLabel: vi.fn().mockResolvedValue(undefined),
        getTransitions: vi.fn(),
        postTransition: vi.fn(),
      } as unknown as ReturnType<typeof createJiraRestClientFromEnv>);

      await addLabel('ACME-1', 'ferry:paused');
      expect(vi.mocked(scanWithGitleaks)).toHaveBeenCalledOnce();
    });
  });

  describe('transitionTicket', () => {
    it('resolves transition id by name (case-insensitive) and posts it', async () => {
      vi.mocked(createJiraRestClientFromEnv).mockReturnValue({
        getIssue: vi.fn(),
        postComment: vi.fn(),
        putComment: vi.fn(),
        createSubtask: vi.fn(),
        addLabel: vi.fn(),
        getTransitions: vi.fn().mockResolvedValue(TRANSITIONS_FIXTURE),
        postTransition: vi.fn().mockResolvedValue(undefined),
      } as unknown as ReturnType<typeof createJiraRestClientFromEnv>);

      await transitionTicket('ACME-1', 'in review');

      const c = getMockClient();
      expect(c.postTransition).toHaveBeenCalledWith('ACME-1', '31');
    });

    it('throws FerryError("state-invariant") when target name is not found', async () => {
      vi.mocked(createJiraRestClientFromEnv).mockReturnValue({
        getIssue: vi.fn(),
        postComment: vi.fn(),
        putComment: vi.fn(),
        createSubtask: vi.fn(),
        addLabel: vi.fn(),
        getTransitions: vi.fn().mockResolvedValue(TRANSITIONS_FIXTURE),
        postTransition: vi.fn(),
      } as unknown as ReturnType<typeof createJiraRestClientFromEnv>);

      await expect(transitionTicket('ACME-1', 'Does Not Exist')).rejects.toMatchObject({
        code: 'state-invariant',
        context: { reason: 'transition-not-found' },
      });
    });
  });
});
