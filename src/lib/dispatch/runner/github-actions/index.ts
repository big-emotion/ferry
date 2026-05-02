import { Octokit } from '@octokit/rest';
import { PHASE_TO_WORKFLOW } from '../../routing.js';
import type {
  CIRunner,
  PR,
  PRRef,
  PRFile,
  PRComment,
  CommitStatus,
  DispatchPayload,
} from '../types.js';

const MAX_CONTENT_CHARS_DEFAULT = 40_000;

export class GitHubActionsRunner implements CIRunner {
  private readonly octokit: Octokit;
  private readonly defaultOwner: string;
  private readonly defaultRepo: string;

  constructor(tokenOrOctokit: string | Octokit, owner: string, repo: string) {
    this.octokit =
      typeof tokenOrOctokit === 'string' ? new Octokit({ auth: tokenOrOctokit }) : tokenOrOctokit;
    this.defaultOwner = owner;
    this.defaultRepo = repo;
  }

  async dispatch(phase: string, payload: DispatchPayload): Promise<void> {
    const route = (PHASE_TO_WORKFLOW as Record<string, { dispatchType: string } | undefined>)[
      phase
    ];
    if (!route) throw new Error(`Unknown phase for dispatch: ${phase}`);
    await this.octokit.repos.createDispatchEvent({
      owner: this.defaultOwner,
      repo: this.defaultRepo,
      event_type: route.dispatchType,
      client_payload: payload as unknown as Record<string, unknown>,
    });
  }

  async getRepoDefaultBranch(owner: string, repo: string): Promise<string> {
    const { data } = await this.octokit.repos.get({ owner, repo });
    return data.default_branch;
  }

  async listPRsForBranch(owner: string, repo: string, branch: string): Promise<PR[]> {
    const { data } = await this.octokit.pulls.list({
      owner,
      repo,
      state: 'open',
      head: `${owner}:${branch}`,
      per_page: 1,
    });
    return data.map((p) => ({
      number: p.number,
      title: p.title,
      baseRef: p.base.ref,
      headRef: p.head.ref,
      headSha: p.head.sha,
      mergeable: null,
    }));
  }

  async getPR(prRef: PRRef): Promise<PR> {
    const { data } = await this.octokit.pulls.get({
      owner: prRef.owner,
      repo: prRef.repo,
      pull_number: prRef.prNumber,
    });
    return {
      number: data.number,
      title: data.title,
      baseRef: data.base.ref,
      headRef: data.head.ref,
      headSha: data.head.sha,
      mergeable: data.mergeable ?? null,
    };
  }

  async listPRFiles(prRef: PRRef): Promise<PRFile[]> {
    const files = await this.octokit.paginate(this.octokit.pulls.listFiles, {
      owner: prRef.owner,
      repo: prRef.repo,
      pull_number: prRef.prNumber,
      per_page: 100,
    });
    return files.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    }));
  }

  async listPRCommits(prRef: PRRef): Promise<Array<{ sha: string; message: string }>> {
    const { data } = await this.octokit.pulls.listCommits({
      owner: prRef.owner,
      repo: prRef.repo,
      pull_number: prRef.prNumber,
      per_page: 50,
    });
    return data.map((c) => ({ sha: c.sha, message: c.commit.message }));
  }

  async getCommitStatus(owner: string, repo: string, sha: string): Promise<CommitStatus> {
    const { data } = await this.octokit.checks.listForRef({ owner, repo, ref: sha, per_page: 100 });
    const runs = data.check_runs;
    if (runs.some((r) => r.status !== 'completed')) return 'pending';
    if (runs.some((r) => r.conclusion === 'failure' || r.conclusion === 'timed_out')) return 'red';
    return 'green';
  }

  async getFileContent(owner: string, repo: string, path: string, ref: string): Promise<string> {
    try {
      const { data } = await this.octokit.repos.getContent({ owner, repo, path, ref });
      if ('content' in data && typeof data.content === 'string') {
        const decoded = Buffer.from(data.content, 'base64').toString('utf8');
        const maxChars =
          parseInt(process.env.FERRY_FILE_DISPLAY_CHARS ?? '', 10) || MAX_CONTENT_CHARS_DEFAULT;
        return decoded.length > maxChars
          ? decoded.slice(0, maxChars) + '\n... (truncated)'
          : decoded;
      }
      return '(binary file or directory — cannot display)';
    } catch (e) {
      return `(error fetching content: ${(e as Error).message})`;
    }
  }

  async createPR(
    owner: string,
    repo: string,
    head: string,
    base: string,
    title: string,
    body: string,
  ): Promise<string> {
    try {
      const { data } = await this.octokit.pulls.create({
        owner,
        repo,
        head,
        base,
        title,
        body,
        draft: true,
      });
      return data.html_url;
    } catch {
      // PR may already exist — find and return its URL
      const { data: existing } = await this.octokit.pulls.list({
        owner,
        repo,
        state: 'open',
        head: `${owner}:${head}`,
        per_page: 1,
      });
      if (existing.length > 0) return existing[0].html_url;
      throw new Error(`Failed to create or find PR for head branch ${head}`);
    }
  }

  async markPRReadyForReview(owner: string, repo: string, prNumber: number): Promise<void> {
    const { data } = await this.octokit.pulls.get({ owner, repo, pull_number: prNumber });
    // GitHub REST does not support draft → ready; GraphQL mutation is required
    await this.octokit.graphql(
      `mutation($pullRequestId: ID!) {
        markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
          pullRequest { id }
        }
      }`,
      { pullRequestId: data.node_id },
    );
  }

  async commentOnPR(prRef: PRRef, body: string): Promise<void> {
    await this.octokit.issues.createComment({
      owner: prRef.owner,
      repo: prRef.repo,
      issue_number: prRef.prNumber,
      body,
    });
  }

  async addLabelsToPR(prRef: PRRef, labels: string[]): Promise<void> {
    await this.octokit.issues.addLabels({
      owner: prRef.owner,
      repo: prRef.repo,
      issue_number: prRef.prNumber,
      labels,
    });
  }

  async removeLabelFromPR(prRef: PRRef, label: string): Promise<void> {
    await this.octokit.issues.removeLabel({
      owner: prRef.owner,
      repo: prRef.repo,
      issue_number: prRef.prNumber,
      name: label,
    });
  }

  async listPRComments(prRef: PRRef, count: number): Promise<PRComment[]> {
    const { data } = await this.octokit.issues.listComments({
      owner: prRef.owner,
      repo: prRef.repo,
      issue_number: prRef.prNumber,
      sort: 'created',
      direction: 'desc',
      per_page: count,
    });
    return data.map((c) => ({ id: c.id, body: c.body ?? '' }));
  }
}
