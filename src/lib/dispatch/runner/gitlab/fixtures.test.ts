/**
 * Fixture-replay tests for the GitLab adapter. Complements the inline-mock
 * tests in `./index.test.ts` by running the adapter against recorded sample
 * shapes from `src/__fixtures__/gitlab/`. The goal is to catch contract drift
 * (a field rename, an unexpected shape) at review time.
 *
 * See `src/__fixtures__/gitlab/README.md` for the refresh workflow.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { GitLabRunner } from './index.js';
import { gitlabFixture, gitlabRawFixture } from '../../../../__fixtures__/gitlab/loader.js';

const TOKEN = 'glpat-fixture-token';
const OWNER = 'acme';
const REPO = 'widgets';
const API = 'https://gitlab.example/api/v4';

function respondWith(payload: unknown, init: { status?: number; raw?: string } = {}): Response {
  const body = init.raw !== undefined ? init.raw : JSON.stringify(payload);
  return new Response(body, { status: init.status ?? 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GitLabRunner ↔ recorded fixtures', () => {
  const runner = new GitLabRunner(TOKEN, OWNER, REPO, {
    apiBase: API,
    pipelineTriggerToken: 'trig-secret',
  });

  it('parses get-project.json into the default branch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respondWith(gitlabFixture('get-project'))),
    );
    expect(await runner.getRepoDefaultBranch(OWNER, REPO)).toBe('main');
  });

  it('parses list-merge-requests.json into PR[] with mergeable=true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respondWith(gitlabFixture('list-merge-requests'))),
    );
    const prs = await runner.listPRsForBranch(OWNER, REPO, 'ferry/ACME-1');
    expect(prs).toHaveLength(1);
    expect(prs[0].number).toBe(7);
    expect(prs[0].headSha).toBe('abc1234deadbeef0000000000000000000000');
    expect(prs[0].mergeable).toBe(true);
  });

  it('parses get-merge-request.json into a full PR record', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respondWith(gitlabFixture('get-merge-request'))),
    );
    const pr = await runner.getPR({ owner: OWNER, repo: REPO, prNumber: 7 });
    expect(pr.title.startsWith('Draft: ')).toBe(true);
    expect(pr.baseRef).toBe('main');
    expect(pr.headRef).toBe('ferry/ACME-1');
    expect(pr.mergeable).toBe(true);
  });

  it('parses get-changes.json into PRFile[] with derived additions/deletions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respondWith(gitlabFixture('get-changes'))),
    );
    const files = await runner.listPRFiles({ owner: OWNER, repo: REPO, prNumber: 7 });
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({ filename: 'src/login.ts', status: 'modified' });
    expect(files[0].additions).toBeGreaterThan(0);
    expect(files[0].deletions).toBeGreaterThan(0);
    expect(files[1].status).toBe('added');
  });

  it('parses list-commits.json', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respondWith(gitlabFixture('list-commits'))),
    );
    const commits = await runner.listPRCommits({ owner: OWNER, repo: REPO, prNumber: 7 });
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({ sha: 'abc1234deadbeef0000000000000000000000' });
  });

  it('parses list-pipelines-success.json as green', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respondWith(gitlabFixture('list-pipelines-success'))),
    );
    expect(await runner.getCommitStatus(OWNER, REPO, 'abc')).toBe('green');
  });

  it('parses list-pipelines-failed.json as red', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respondWith(gitlabFixture('list-pipelines-failed'))),
    );
    expect(await runner.getCommitStatus(OWNER, REPO, 'abc')).toBe('red');
  });

  it('parses get-raw-file.txt into the file content', async () => {
    const raw = gitlabRawFixture('get-raw-file.txt');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(raw, { status: 200 })),
    );
    const content = await runner.getFileContent(OWNER, REPO, 'src/login.ts', 'main');
    expect(content).toContain('export function login');
  });

  it('accepts the post-note-201.json response shape on commentOnPR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respondWith(gitlabFixture('post-note-201'))),
    );
    await expect(
      runner.commentOnPR({ owner: OWNER, repo: REPO, prNumber: 7 }, 'hi'),
    ).resolves.toBeUndefined();
  });

  it('accepts the put-merge-request-200.json response shape on addLabelsToPR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respondWith(gitlabFixture('put-merge-request-200'))),
    );
    await expect(
      runner.addLabelsToPR({ owner: OWNER, repo: REPO, prNumber: 7 }, ['ferry:approved']),
    ).resolves.toBeUndefined();
  });

  it('accepts post-trigger-pipeline-201.json on dispatch()', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respondWith(gitlabFixture('post-trigger-pipeline-201'), { status: 201 })),
    );
    await expect(
      runner.dispatch('review', {
        version: 'v1',
        event_id: 'evt',
        ticket_key: 'ACME-1',
        phase: 'review',
        source: 'jira-column',
        ts: '2026-01-01T00:00:00Z',
      }),
    ).resolves.toBeUndefined();
  });
});
