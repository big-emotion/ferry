import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitLabRunner, collapsePipelineStatus } from './index.js';
import { FerryError } from '../../../errors/index.js';

const TOKEN = 'glpat-test-token';
const OWNER = 'acme';
const REPO = 'widgets';
const PROJECT = encodeURIComponent(`${OWNER}/${REPO}`);
const API = 'https://gitlab.example/api/v4';

interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

interface MockResponse {
  status?: number;
  body?: unknown;
  rawBody?: string;
}

function mockFetch(...responses: MockResponse[]): {
  fn: ReturnType<typeof vi.fn>;
  calls: CapturedRequest[];
} {
  const calls: CapturedRequest[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const headers: Record<string, string> = {};
    if (init.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k] = v;
      }
    }
    calls.push({
      method: init.method ?? 'GET',
      url,
      headers,
      body: typeof init.body === 'string' ? init.body : undefined,
    });
    const resp = responses[i] ?? { status: 200, body: {} };
    i += 1;
    const status = resp.status ?? 200;
    return new Response(
      resp.rawBody !== undefined ? resp.rawBody : JSON.stringify(resp.body ?? {}),
      { status },
    );
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

beforeEach(() => {
  delete process.env.FERRY_FILE_DISPLAY_CHARS;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GitLabRunner', () => {
  const runner = new GitLabRunner(TOKEN, OWNER, REPO, {
    apiBase: API,
    pipelineTriggerToken: 'trig-secret',
    triggerRef: 'main',
  });

  it('sets Bearer auth header on every API call', async () => {
    const { calls } = mockFetch({ body: { default_branch: 'main' } });
    await runner.getRepoDefaultBranch(OWNER, REPO);
    expect(calls[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].url).toBe(`${API}/projects/${PROJECT}`);
  });

  it('returns default branch from /projects/:id', async () => {
    mockFetch({ body: { id: 1, default_branch: 'trunk' } });
    expect(await runner.getRepoDefaultBranch(OWNER, REPO)).toBe('trunk');
  });

  it('lists open MRs for a source branch', async () => {
    const { calls } = mockFetch({
      body: [
        {
          iid: 42,
          title: 'Draft: feat: foo',
          source_branch: 'ferry/ACME-1',
          target_branch: 'main',
          sha: 'abc123',
          web_url: `https://gitlab.example/${OWNER}/${REPO}/-/merge_requests/42`,
          has_conflicts: false,
        },
      ],
    });
    const prs = await runner.listPRsForBranch(OWNER, REPO, 'ferry/ACME-1');
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({
      number: 42,
      title: 'Draft: feat: foo',
      baseRef: 'main',
      headRef: 'ferry/ACME-1',
      headSha: 'abc123',
      mergeable: true,
    });
    expect(calls[0].url).toContain('state=opened');
    expect(calls[0].url).toContain('source_branch=ferry%2FACME-1');
  });

  it('getPR maps has_conflicts=true to mergeable=false', async () => {
    mockFetch({
      body: {
        iid: 5,
        title: 'WIP',
        source_branch: 'topic',
        target_branch: 'main',
        sha: 'def456',
        web_url: 'x',
        has_conflicts: true,
      },
    });
    const pr = await runner.getPR({ owner: OWNER, repo: REPO, prNumber: 5 });
    expect(pr.mergeable).toBe(false);
  });

  it('createPR opens a draft MR by default and returns its URL', async () => {
    const { calls } = mockFetch({
      body: {
        iid: 7,
        title: 'Draft: feat: ACME-1',
        source_branch: 'ferry/ACME-1',
        target_branch: 'main',
        sha: 'abc',
        web_url: 'https://gitlab.example/acme/widgets/-/merge_requests/7',
      },
    });
    const url = await runner.createPR(OWNER, REPO, 'ferry/ACME-1', 'main', 'feat: ACME-1', 'body');
    expect(url).toBe('https://gitlab.example/acme/widgets/-/merge_requests/7');
    expect(calls[0].method).toBe('POST');
    const body = JSON.parse(calls[0].body ?? '{}');
    expect(body.title).toBe('Draft: feat: ACME-1');
    expect(body.source_branch).toBe('ferry/ACME-1');
    expect(body.target_branch).toBe('main');
  });

  it('createPR returns the existing MR URL if creation fails', async () => {
    mockFetch(
      { status: 409, body: { message: 'MR already exists' } },
      {
        body: [
          {
            iid: 12,
            title: 'Draft: feat: foo',
            source_branch: 'ferry/ACME-1',
            target_branch: 'main',
            sha: 's',
            web_url: 'https://gitlab.example/acme/widgets/-/merge_requests/12',
            has_conflicts: false,
          },
        ],
      },
      {
        body: {
          iid: 12,
          title: 'Draft: feat: foo',
          source_branch: 'ferry/ACME-1',
          target_branch: 'main',
          sha: 's',
          web_url: 'https://gitlab.example/acme/widgets/-/merge_requests/12',
        },
      },
    );
    const url = await runner.createPR(OWNER, REPO, 'ferry/ACME-1', 'main', 'feat: foo', 'body');
    expect(url).toBe('https://gitlab.example/acme/widgets/-/merge_requests/12');
  });

  it('markPRReadyForReview strips the Draft: prefix from the title', async () => {
    const { calls } = mockFetch(
      {
        body: {
          iid: 7,
          title: 'Draft: feat: ACME-1',
          source_branch: 'b',
          target_branch: 'm',
          sha: 's',
          web_url: 'u',
        },
      },
      { body: {} },
    );
    await runner.markPRReadyForReview(OWNER, REPO, 7);
    const put = calls[1];
    expect(put.method).toBe('PUT');
    expect(JSON.parse(put.body ?? '{}')).toEqual({ title: 'feat: ACME-1' });
  });

  it('markPRReadyForReview is a no-op when title has no Draft prefix', async () => {
    const { calls } = mockFetch({
      body: {
        iid: 7,
        title: 'feat: ACME-1',
        source_branch: 'b',
        target_branch: 'm',
        sha: 's',
        web_url: 'u',
      },
    });
    await runner.markPRReadyForReview(OWNER, REPO, 7);
    expect(calls).toHaveLength(1);
  });

  it('commentOnPR posts a note', async () => {
    const { calls } = mockFetch({ body: { id: 1, body: 'hi' } });
    await runner.commentOnPR({ owner: OWNER, repo: REPO, prNumber: 9 }, 'hi');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe(`${API}/projects/${PROJECT}/merge_requests/9/notes`);
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ body: 'hi' });
  });

  it('addLabelsToPR comma-joins labels and sends them via add_labels', async () => {
    const { calls } = mockFetch({ body: {} });
    await runner.addLabelsToPR({ owner: OWNER, repo: REPO, prNumber: 9 }, [
      'ferry:approved',
      'ferry:cost-estimate:1.00-2.00',
    ]);
    expect(calls[0].method).toBe('PUT');
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
      add_labels: 'ferry:approved,ferry:cost-estimate:1.00-2.00',
    });
  });

  it('addLabelsToPR is a no-op when labels is empty', async () => {
    const { calls } = mockFetch();
    await runner.addLabelsToPR({ owner: OWNER, repo: REPO, prNumber: 9 }, []);
    expect(calls).toHaveLength(0);
  });

  it('removeLabelFromPR sends remove_labels', async () => {
    const { calls } = mockFetch({ body: {} });
    await runner.removeLabelFromPR({ owner: OWNER, repo: REPO, prNumber: 9 }, 'ferry:reviewing');
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ remove_labels: 'ferry:reviewing' });
  });

  it('listPRComments returns notes sorted desc, capped at count', async () => {
    const { calls } = mockFetch({
      body: [
        { id: 3, body: 'c' },
        { id: 2, body: 'b' },
        { id: 1, body: 'a' },
      ],
    });
    const out = await runner.listPRComments({ owner: OWNER, repo: REPO, prNumber: 9 }, 3);
    expect(out).toEqual([
      { id: 3, body: 'c' },
      { id: 2, body: 'b' },
      { id: 1, body: 'a' },
    ]);
    expect(calls[0].url).toContain('sort=desc');
    expect(calls[0].url).toContain('per_page=3');
  });

  it('listPRFiles derives status, additions, deletions from change records', async () => {
    mockFetch({
      body: {
        changes: [
          {
            old_path: 'a.ts',
            new_path: 'a.ts',
            new_file: false,
            renamed_file: false,
            deleted_file: false,
            diff: '@@ -1 +1,2 @@\n+new line\n-old line\n+another',
          },
          {
            old_path: 'b.ts',
            new_path: 'b.ts',
            new_file: true,
            renamed_file: false,
            deleted_file: false,
            diff: '+content',
          },
        ],
      },
    });
    const files = await runner.listPRFiles({ owner: OWNER, repo: REPO, prNumber: 1 });
    expect(files[0]).toMatchObject({
      filename: 'a.ts',
      status: 'modified',
      additions: 2,
      deletions: 1,
    });
    expect(files[1].status).toBe('added');
  });

  it('listPRCommits returns sha/message pairs', async () => {
    mockFetch({
      body: [
        { id: 'sha1', message: 'first' },
        { id: 'sha2', message: 'second' },
      ],
    });
    const commits = await runner.listPRCommits({ owner: OWNER, repo: REPO, prNumber: 1 });
    expect(commits).toEqual([
      { sha: 'sha1', message: 'first' },
      { sha: 'sha2', message: 'second' },
    ]);
  });

  it('getCommitStatus returns pending when no pipeline exists', async () => {
    mockFetch({ body: [] });
    expect(await runner.getCommitStatus(OWNER, REPO, 'abc')).toBe('pending');
  });

  it('getCommitStatus collapses GitLab statuses correctly', async () => {
    expect(collapsePipelineStatus('success')).toBe('green');
    expect(collapsePipelineStatus('skipped')).toBe('green');
    expect(collapsePipelineStatus('manual')).toBe('green');
    expect(collapsePipelineStatus('failed')).toBe('red');
    expect(collapsePipelineStatus('canceled')).toBe('red');
    expect(collapsePipelineStatus('pending')).toBe('pending');
    expect(collapsePipelineStatus('running')).toBe('pending');
    expect(collapsePipelineStatus('preparing')).toBe('pending');
    expect(collapsePipelineStatus('scheduled')).toBe('pending');
  });

  it('getFileContent returns raw text and truncates beyond the cap', async () => {
    const big = 'x'.repeat(50_000);
    mockFetch({ rawBody: big });
    process.env.FERRY_FILE_DISPLAY_CHARS = '40000';
    const content = await runner.getFileContent(OWNER, REPO, 'src/foo.ts', 'main');
    expect(content.length).toBe(40_000 + '\n... (truncated)'.length);
    expect(content.endsWith('... (truncated)')).toBe(true);
  });

  it('getFileContent returns a friendly error string on HTTP failure', async () => {
    mockFetch({ status: 404, body: {} });
    const content = await runner.getFileContent(OWNER, REPO, 'missing.ts', 'main');
    expect(content).toMatch(/error fetching content/);
    expect(content).toContain('404');
  });

  it('dispatch triggers a pipeline with the envelope as FERRY_ENVELOPE_PAYLOAD', async () => {
    const { calls } = mockFetch({ body: { id: 100, status: 'pending' } });
    await runner.dispatch('review', {
      version: 'v1',
      event_id: 'evt1234',
      ticket_key: 'ACME-1',
      phase: 'review',
      source: 'jira-column',
      ts: '2026-01-01T00:00:00Z',
    });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe(`${API}/projects/${PROJECT}/trigger/pipeline`);
    const body = calls[0].body ?? '';
    expect(body).toContain('token=trig-secret');
    expect(body).toContain('ref=main');
    expect(body).toContain('variables%5BFERRY_DISPATCH_TYPE%5D=');
    expect(body).toContain('variables%5BFERRY_ENVELOPE_PAYLOAD%5D=');
  });

  it('dispatch throws a clear error when the trigger token is absent', async () => {
    const noToken = new GitLabRunner(TOKEN, OWNER, REPO, { apiBase: API });
    await expect(
      noToken.dispatch('review', {
        version: 'v1',
        event_id: 'e',
        ticket_key: 'A-1',
        phase: 'review',
        source: 'jira-column',
        ts: '2026-01-01T00:00:00Z',
      }),
    ).rejects.toThrow(FerryError);
  });

  it('throws a FerryError(transient) for any 5xx response on a regular request', async () => {
    mockFetch({ status: 503, body: {} });
    await expect(runner.getRepoDefaultBranch(OWNER, REPO)).rejects.toThrow(FerryError);
  });
});
