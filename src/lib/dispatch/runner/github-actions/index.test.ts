import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Octokit } from '@octokit/rest';
import { GitHubActionsRunner } from './index.js';

type MockOctokit = {
  pulls: {
    list: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    listFiles: ReturnType<typeof vi.fn>;
    listCommits: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  issues: {
    createComment: ReturnType<typeof vi.fn>;
    addLabels: ReturnType<typeof vi.fn>;
    removeLabel: ReturnType<typeof vi.fn>;
    listComments: ReturnType<typeof vi.fn>;
  };
  checks: {
    listForRef: ReturnType<typeof vi.fn>;
  };
  repos: {
    getContent: ReturnType<typeof vi.fn>;
    createDispatchEvent: ReturnType<typeof vi.fn>;
  };
  paginate: ReturnType<typeof vi.fn>;
  graphql: ReturnType<typeof vi.fn>;
};

function makeMockOctokit(): MockOctokit {
  return {
    pulls: {
      list: vi.fn(),
      get: vi.fn(),
      listFiles: vi.fn(),
      listCommits: vi.fn(),
      create: vi.fn(),
    },
    issues: {
      createComment: vi.fn(),
      addLabels: vi.fn(),
      removeLabel: vi.fn(),
      listComments: vi.fn(),
    },
    checks: {
      listForRef: vi.fn(),
    },
    repos: {
      getContent: vi.fn(),
      createDispatchEvent: vi.fn(),
    },
    paginate: vi.fn(),
    graphql: vi.fn(),
  };
}

const OWNER = 'acme';
const REPO = 'ferry';
const PR_REF = { owner: OWNER, repo: REPO, prNumber: 42 };

describe('GitHubActionsRunner', () => {
  let mock: MockOctokit;
  let runner: GitHubActionsRunner;

  beforeEach(() => {
    mock = makeMockOctokit();
    runner = new GitHubActionsRunner(mock as unknown as Octokit, OWNER, REPO);
  });

  describe('getCommitStatus', () => {
    it('returns green when all checks completed without failure', async () => {
      mock.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            { status: 'completed', conclusion: 'success' },
            { status: 'completed', conclusion: 'neutral' },
          ],
        },
      });
      expect(await runner.getCommitStatus(OWNER, REPO, 'abc123')).toBe('green');
    });

    it('returns pending when any check is not completed', async () => {
      mock.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            { status: 'completed', conclusion: 'success' },
            { status: 'in_progress', conclusion: null },
          ],
        },
      });
      expect(await runner.getCommitStatus(OWNER, REPO, 'abc123')).toBe('pending');
    });

    it('returns red when any check has failed', async () => {
      mock.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            { status: 'completed', conclusion: 'success' },
            { status: 'completed', conclusion: 'failure' },
          ],
        },
      });
      expect(await runner.getCommitStatus(OWNER, REPO, 'abc123')).toBe('red');
    });

    it('returns red when any check timed out', async () => {
      mock.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [{ status: 'completed', conclusion: 'timed_out' }],
        },
      });
      expect(await runner.getCommitStatus(OWNER, REPO, 'abc123')).toBe('red');
    });
  });

  describe('createPR', () => {
    it('opens PR as draft and returns html_url', async () => {
      mock.pulls.create.mockResolvedValue({
        data: { html_url: 'https://github.com/acme/ferry/pull/99' },
      });
      const url = await runner.createPR(OWNER, REPO, 'feature-branch', 'main', 'title', 'body');
      expect(url).toBe('https://github.com/acme/ferry/pull/99');
      expect(mock.pulls.create).toHaveBeenCalledWith(
        expect.objectContaining({ draft: true }),
      );
    });

    it('returns existing PR url when creation fails (PR already exists)', async () => {
      mock.pulls.create.mockRejectedValue(new Error('Validation Failed'));
      mock.pulls.list.mockResolvedValue({
        data: [{ html_url: 'https://github.com/acme/ferry/pull/42', number: 42 }],
      });
      const url = await runner.createPR(OWNER, REPO, 'feature-branch', 'main', 'title', 'body');
      expect(url).toBe('https://github.com/acme/ferry/pull/42');
    });

    it('throws when creation fails and no existing PR is found', async () => {
      mock.pulls.create.mockRejectedValue(new Error('Validation Failed'));
      mock.pulls.list.mockResolvedValue({ data: [] });
      await expect(
        runner.createPR(OWNER, REPO, 'feature-branch', 'main', 'title', 'body'),
      ).rejects.toThrow('Failed to create or find PR');
    });
  });

  describe('markPRReadyForReview', () => {
    it('fetches node_id then calls markPullRequestReadyForReview mutation', async () => {
      mock.pulls.get.mockResolvedValue({
        data: {
          number: 42,
          title: 'Fix',
          base: { ref: 'main' },
          head: { ref: 'ferry/CHAN-1', sha: 'cafebabe' },
          mergeable: true,
          node_id: 'PR_kwABCDEF',
        },
      });
      mock.graphql.mockResolvedValue({
        markPullRequestReadyForReview: { pullRequest: { id: 'PR_kwABCDEF' } },
      });

      await runner.markPRReadyForReview(OWNER, REPO, 42);

      expect(mock.pulls.get).toHaveBeenCalledWith({ owner: OWNER, repo: REPO, pull_number: 42 });
      expect(mock.graphql).toHaveBeenCalledWith(
        expect.stringContaining('markPullRequestReadyForReview'),
        { pullRequestId: 'PR_kwABCDEF' },
      );
    });

    it('propagates errors from GraphQL call', async () => {
      mock.pulls.get.mockResolvedValue({
        data: {
          node_id: 'PR_kwABCDEF',
          number: 42,
          title: 'Fix',
          base: { ref: 'main' },
          head: { ref: 'b', sha: 's' },
          mergeable: null,
        },
      });
      mock.graphql.mockRejectedValue(new Error('GraphQL error'));

      await expect(runner.markPRReadyForReview(OWNER, REPO, 42)).rejects.toThrow('GraphQL error');
    });
  });

  describe('listPRsForBranch', () => {
    it('returns mapped PR list', async () => {
      mock.pulls.list.mockResolvedValue({
        data: [
          {
            number: 7,
            title: 'My PR',
            base: { ref: 'main' },
            head: { ref: 'feature', sha: 'deadbeef' },
          },
        ],
      });
      const prs = await runner.listPRsForBranch(OWNER, REPO, 'feature');
      expect(prs).toHaveLength(1);
      expect(prs[0]).toMatchObject({
        number: 7,
        title: 'My PR',
        baseRef: 'main',
        headRef: 'feature',
        headSha: 'deadbeef',
        mergeable: null,
      });
    });
  });

  describe('getPR', () => {
    it('returns PR with mergeable field', async () => {
      mock.pulls.get.mockResolvedValue({
        data: {
          number: 42,
          title: 'Fix: something',
          base: { ref: 'main' },
          head: { ref: 'ferry/CHAN-1', sha: 'cafebabe' },
          mergeable: true,
        },
      });
      const pr = await runner.getPR(PR_REF);
      expect(pr).toMatchObject({
        number: 42,
        headSha: 'cafebabe',
        mergeable: true,
      });
    });

    it('maps null mergeable from Octokit to null', async () => {
      mock.pulls.get.mockResolvedValue({
        data: {
          number: 42,
          title: 'Fix',
          base: { ref: 'main' },
          head: { ref: 'ferry/CHAN-1', sha: 'cafebabe' },
          mergeable: null,
        },
      });
      const pr = await runner.getPR(PR_REF);
      expect(pr.mergeable).toBeNull();
    });
  });

  describe('listPRFiles', () => {
    it('paginates and maps file list', async () => {
      mock.paginate.mockResolvedValue([
        { filename: 'src/foo.ts', status: 'modified', additions: 5, deletions: 2, patch: '@@ ...' },
        { filename: 'src/bar.ts', status: 'added', additions: 10, deletions: 0, patch: undefined },
      ]);
      const files = await runner.listPRFiles(PR_REF);
      expect(files).toHaveLength(2);
      expect(files[0].filename).toBe('src/foo.ts');
      expect(files[1].patch).toBeUndefined();
    });
  });

  describe('listPRCommits', () => {
    it('returns sha and message for each commit', async () => {
      mock.pulls.listCommits.mockResolvedValue({
        data: [
          { sha: 'abc1234', commit: { message: 'feat: add feature\n\ndetails' } },
          { sha: 'def5678', commit: { message: 'fix: a bug' } },
        ],
      });
      const commits = await runner.listPRCommits(PR_REF);
      expect(commits).toEqual([
        { sha: 'abc1234', message: 'feat: add feature\n\ndetails' },
        { sha: 'def5678', message: 'fix: a bug' },
      ]);
    });
  });

  describe('commentOnPR', () => {
    it('calls createComment with correct params', async () => {
      mock.issues.createComment.mockResolvedValue({ data: { id: 1 } });
      await runner.commentOnPR(PR_REF, 'hello world');
      expect(mock.issues.createComment).toHaveBeenCalledWith({
        owner: OWNER,
        repo: REPO,
        issue_number: 42,
        body: 'hello world',
      });
    });
  });

  describe('addLabelsToPR', () => {
    it('calls addLabels with correct params', async () => {
      mock.issues.addLabels.mockResolvedValue({ data: [] });
      await runner.addLabelsToPR(PR_REF, ['ferry:approved']);
      expect(mock.issues.addLabels).toHaveBeenCalledWith({
        owner: OWNER,
        repo: REPO,
        issue_number: 42,
        labels: ['ferry:approved'],
      });
    });
  });

  describe('removeLabelFromPR', () => {
    it('calls removeLabel with correct params', async () => {
      mock.issues.removeLabel.mockResolvedValue({ data: {} });
      await runner.removeLabelFromPR(PR_REF, 'ferry:reviewing');
      expect(mock.issues.removeLabel).toHaveBeenCalledWith({
        owner: OWNER,
        repo: REPO,
        issue_number: 42,
        name: 'ferry:reviewing',
      });
    });
  });

  describe('listPRComments', () => {
    it('returns id and body for each comment', async () => {
      mock.issues.listComments.mockResolvedValue({
        data: [
          { id: 1001, body: '[ferry:reviewer:abc] LGTM' },
          { id: 1002, body: null },
        ],
      });
      const comments = await runner.listPRComments(PR_REF, 30);
      expect(comments).toEqual([
        { id: 1001, body: '[ferry:reviewer:abc] LGTM' },
        { id: 1002, body: '' },
      ]);
    });
  });

  describe('dispatch', () => {
    it('sends createDispatchEvent for a known phase', async () => {
      mock.repos.createDispatchEvent.mockResolvedValue({ data: {} });
      const payload = {
        version: 'v1' as const,
        event_id: 'evt-1',
        ticket_key: 'CHAN-1',
        phase: 'dev' as const,
        source: 'jira-column' as const,
        ts: '2026-01-01T00:00:00Z',
      };
      await runner.dispatch('dev', payload);
      expect(mock.repos.createDispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: OWNER,
          repo: REPO,
          event_type: 'ferry-dev',
          client_payload: payload,
        }),
      );
    });

    it('throws for an unknown phase', async () => {
      await expect(runner.dispatch('unknown-phase', {} as never)).rejects.toThrow(
        'Unknown phase for dispatch: unknown-phase',
      );
    });
  });

  describe('getFileContent', () => {
    it('decodes base64 file content', async () => {
      const content = 'hello world';
      mock.repos.getContent.mockResolvedValue({
        data: { content: Buffer.from(content).toString('base64') },
      });
      const result = await runner.getFileContent(OWNER, REPO, 'src/foo.ts', 'main');
      expect(result).toBe(content);
    });

    it('returns fallback message for binary files', async () => {
      mock.repos.getContent.mockResolvedValue({ data: { type: 'file' } });
      const result = await runner.getFileContent(OWNER, REPO, 'image.png', 'main');
      expect(result).toBe('(binary file or directory — cannot display)');
    });

    it('returns error message when API throws', async () => {
      mock.repos.getContent.mockRejectedValue(new Error('Not Found'));
      const result = await runner.getFileContent(OWNER, REPO, 'missing.ts', 'main');
      expect(result).toContain('error fetching content');
    });
  });
});
