/**
 * GitLab CIRunner adapter — implements the forge-neutral CIRunner against the
 * GitLab REST API (v4). Uses native fetch; no SDK dependency.
 *
 * Vocabulary mapping:
 *   - GitHub "pull request" ↔ GitLab "merge request"
 *   - "Draft PR"            ↔ "Draft: …" title prefix
 *   - "GitHub Checks"       ↔ "latest pipeline for ref"
 *   - repository_dispatch   ↔ pipeline trigger token
 *
 * Authentication: a GitLab project / personal access token with `api` scope.
 * Required env vars (read in factory.ts):
 *   FERRY_GITLAB_TOKEN              — API token (Bearer)
 *   FERRY_GITLAB_API_BASE           — optional, defaults to https://gitlab.com/api/v4
 *   FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN — only required if you use dispatch()
 *   FERRY_GITLAB_TRIGGER_REF        — pipeline ref used by dispatch(); default 'main'
 */
import { FerryError } from '../../../errors/index.js';
import { PHASE_TO_WORKFLOW } from '../../routing.js';
import type {
  CIRunner,
  CommitStatus,
  DispatchPayload,
  PR,
  PRComment,
  PRFile,
  PRRef,
} from '../types.js';

const MAX_CONTENT_CHARS_DEFAULT = 40_000;

const DRAFT_PREFIX = 'Draft: ';

export interface GitLabRunnerOptions {
  /** Base URL of the GitLab API. Defaults to `https://gitlab.com/api/v4`. */
  apiBase?: string;
  /** Token used by `dispatch()` to trigger a pipeline. */
  pipelineTriggerToken?: string;
  /** Ref to trigger pipelines on. Defaults to `main`. */
  triggerRef?: string;
}

interface GitLabProject {
  id: number;
  default_branch: string;
}

interface GitLabMergeRequest {
  iid: number;
  title: string;
  source_branch: string;
  target_branch: string;
  sha: string;
  web_url: string;
  has_conflicts?: boolean;
  detailed_merge_status?: string;
  labels?: string[];
}

interface GitLabChangesResponse {
  changes: Array<{
    old_path: string;
    new_path: string;
    new_file: boolean;
    renamed_file: boolean;
    deleted_file: boolean;
    diff: string;
  }>;
}

interface GitLabCommit {
  id: string;
  message: string;
}

interface GitLabPipeline {
  id: number;
  status:
    | 'created'
    | 'waiting_for_resource'
    | 'preparing'
    | 'pending'
    | 'running'
    | 'success'
    | 'failed'
    | 'canceled'
    | 'skipped'
    | 'manual'
    | 'scheduled';
}

interface GitLabNote {
  id: number;
  body: string;
}

export class GitLabRunner implements CIRunner {
  private readonly authHeader: string;
  private readonly apiBase: string;
  private readonly pipelineTriggerToken?: string;
  private readonly triggerRef: string;

  constructor(
    token: string,
    private readonly defaultOwner: string,
    private readonly defaultRepo: string,
    opts: GitLabRunnerOptions = {},
  ) {
    this.authHeader = `Bearer ${token}`;
    this.apiBase = (opts.apiBase ?? 'https://gitlab.com/api/v4').replace(/\/+$/, '');
    this.pipelineTriggerToken = opts.pipelineTriggerToken;
    this.triggerRef = opts.triggerRef ?? 'main';
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private projectPath(owner: string, repo: string): string {
    return encodeURIComponent(`${owner}/${repo}`);
  }

  private baseHeaders(extra?: Record<string, string>): Record<string, string> {
    return { Authorization: this.authHeader, Accept: 'application/json', ...extra };
  }

  private async request<T>(
    method: string,
    path: string,
    init: { body?: unknown; rawBody?: BodyInit; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const headers = this.baseHeaders(init.headers);
    let body: BodyInit | undefined;
    if (init.rawBody !== undefined) {
      body = init.rawBody;
    } else if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.body);
    }
    const url = `${this.apiBase}${path}`;
    const response = await fetch(url, { method, headers, body });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new FerryError('transient', {
        reason: 'gitlab-request-failed',
        method,
        path,
        status: response.status,
        body: text.slice(0, 500),
      });
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private async getProject(owner: string, repo: string): Promise<GitLabProject> {
    return this.request<GitLabProject>('GET', `/projects/${this.projectPath(owner, repo)}`);
  }

  // ── CIRunner methods ─────────────────────────────────────────────────────

  async dispatch(phase: string, payload: DispatchPayload): Promise<void> {
    const route = (PHASE_TO_WORKFLOW as Record<string, { dispatchType: string } | undefined>)[
      phase
    ];
    if (!route) throw new Error(`Unknown phase for dispatch: ${phase}`);
    if (!this.pipelineTriggerToken) {
      throw new FerryError('state-invariant', {
        reason: 'missing-pipeline-trigger-token',
        env: 'FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN',
      });
    }
    const form = new URLSearchParams();
    form.set('token', this.pipelineTriggerToken);
    form.set('ref', this.triggerRef);
    form.set('variables[FERRY_DISPATCH_TYPE]', route.dispatchType);
    form.set('variables[FERRY_ENVELOPE_PAYLOAD]', JSON.stringify(payload));
    const url = `${this.apiBase}/projects/${this.projectPath(this.defaultOwner, this.defaultRepo)}/trigger/pipeline`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new FerryError('transient', {
        reason: 'gitlab-pipeline-trigger-failed',
        status: response.status,
        body: text.slice(0, 500),
      });
    }
  }

  async getRepoDefaultBranch(owner: string, repo: string): Promise<string> {
    const project = await this.getProject(owner, repo);
    return project.default_branch;
  }

  async listPRsForBranch(owner: string, repo: string, branch: string): Promise<PR[]> {
    const path = `/projects/${this.projectPath(owner, repo)}/merge_requests?state=opened&source_branch=${encodeURIComponent(branch)}&per_page=1`;
    const mrs = await this.request<GitLabMergeRequest[]>('GET', path);
    return mrs.map((mr) => this.toPR(mr));
  }

  async getPR(prRef: PRRef): Promise<PR> {
    const path = `/projects/${this.projectPath(prRef.owner, prRef.repo)}/merge_requests/${prRef.prNumber}`;
    const mr = await this.request<GitLabMergeRequest>('GET', path);
    return this.toPR(mr);
  }

  async listPRFiles(prRef: PRRef): Promise<PRFile[]> {
    const path = `/projects/${this.projectPath(prRef.owner, prRef.repo)}/merge_requests/${prRef.prNumber}/changes`;
    const data = await this.request<GitLabChangesResponse>('GET', path);
    return data.changes.map((c) => ({
      filename: c.new_path || c.old_path,
      status: c.new_file
        ? 'added'
        : c.deleted_file
          ? 'removed'
          : c.renamed_file
            ? 'renamed'
            : 'modified',
      additions: countDiffLines(c.diff, '+'),
      deletions: countDiffLines(c.diff, '-'),
      patch: c.diff || undefined,
    }));
  }

  async listPRCommits(prRef: PRRef): Promise<Array<{ sha: string; message: string }>> {
    const path = `/projects/${this.projectPath(prRef.owner, prRef.repo)}/merge_requests/${prRef.prNumber}/commits?per_page=50`;
    const commits = await this.request<GitLabCommit[]>('GET', path);
    return commits.map((c) => ({ sha: c.id, message: c.message }));
  }

  async getCommitStatus(owner: string, repo: string, sha: string): Promise<CommitStatus> {
    const path = `/projects/${this.projectPath(owner, repo)}/pipelines?sha=${encodeURIComponent(sha)}&per_page=1&order_by=id&sort=desc`;
    const pipelines = await this.request<GitLabPipeline[]>('GET', path);
    if (pipelines.length === 0) return 'pending';
    return collapsePipelineStatus(pipelines[0].status);
  }

  async getFileContent(owner: string, repo: string, path: string, ref: string): Promise<string> {
    try {
      const url = `${this.apiBase}/projects/${this.projectPath(owner, repo)}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref)}`;
      const response = await fetch(url, { method: 'GET', headers: this.baseHeaders() });
      if (!response.ok) {
        return `(error fetching content: HTTP ${response.status})`;
      }
      const text = await response.text();
      const maxChars =
        parseInt(process.env.FERRY_FILE_DISPLAY_CHARS ?? '', 10) || MAX_CONTENT_CHARS_DEFAULT;
      return text.length > maxChars ? text.slice(0, maxChars) + '\n... (truncated)' : text;
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
    const draftTitle = title.startsWith(DRAFT_PREFIX) ? title : `${DRAFT_PREFIX}${title}`;
    const path = `/projects/${this.projectPath(owner, repo)}/merge_requests`;
    try {
      const mr = await this.request<GitLabMergeRequest>('POST', path, {
        body: {
          source_branch: head,
          target_branch: base,
          title: draftTitle,
          description: body,
        },
      });
      return mr.web_url;
    } catch {
      // MR may already exist — find and return its URL.
      const existing = await this.listPRsForBranch(owner, repo, head);
      if (existing.length > 0) {
        const mr = await this.request<GitLabMergeRequest>(
          'GET',
          `/projects/${this.projectPath(owner, repo)}/merge_requests/${existing[0].number}`,
        );
        return mr.web_url;
      }
      throw new Error(`Failed to create or find MR for source branch ${head}`);
    }
  }

  async markPRReadyForReview(owner: string, repo: string, prNumber: number): Promise<void> {
    const mr = await this.request<GitLabMergeRequest>(
      'GET',
      `/projects/${this.projectPath(owner, repo)}/merge_requests/${prNumber}`,
    );
    if (!mr.title.startsWith(DRAFT_PREFIX)) return;
    const newTitle = mr.title.slice(DRAFT_PREFIX.length);
    await this.request(
      'PUT',
      `/projects/${this.projectPath(owner, repo)}/merge_requests/${prNumber}`,
      {
        body: { title: newTitle },
      },
    );
  }

  async commentOnPR(prRef: PRRef, body: string): Promise<void> {
    await this.request(
      'POST',
      `/projects/${this.projectPath(prRef.owner, prRef.repo)}/merge_requests/${prRef.prNumber}/notes`,
      { body: { body } },
    );
  }

  async addLabelsToPR(prRef: PRRef, labels: string[]): Promise<void> {
    if (labels.length === 0) return;
    await this.request(
      'PUT',
      `/projects/${this.projectPath(prRef.owner, prRef.repo)}/merge_requests/${prRef.prNumber}`,
      { body: { add_labels: labels.join(',') } },
    );
  }

  async removeLabelFromPR(prRef: PRRef, label: string): Promise<void> {
    await this.request(
      'PUT',
      `/projects/${this.projectPath(prRef.owner, prRef.repo)}/merge_requests/${prRef.prNumber}`,
      { body: { remove_labels: label } },
    );
  }

  async listPRComments(prRef: PRRef, count: number): Promise<PRComment[]> {
    const perPage = Math.min(Math.max(count, 1), 100);
    const path = `/projects/${this.projectPath(prRef.owner, prRef.repo)}/merge_requests/${prRef.prNumber}/notes?sort=desc&order_by=created_at&per_page=${perPage}`;
    const notes = await this.request<GitLabNote[]>('GET', path);
    return notes.map((n) => ({ id: n.id, body: n.body ?? '' }));
  }

  async mergePR(
    prRef: PRRef,
    strategy: 'squash' | 'merge' | 'rebase',
    commitTitle?: string,
  ): Promise<void> {
    const path = `/projects/${this.projectPath(prRef.owner, prRef.repo)}/merge_requests/${prRef.prNumber}/merge`;
    await this.request('PUT', path, {
      body: {
        should_remove_source_branch: false,
        squash: strategy === 'squash',
        ...(commitTitle !== undefined ? { squash_commit_message: commitTitle } : {}),
      },
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private toPR(mr: GitLabMergeRequest): PR {
    const conflict =
      mr.has_conflicts === true ||
      (typeof mr.detailed_merge_status === 'string' &&
        mr.detailed_merge_status.includes('conflict'));
    const mergeable = conflict === true ? false : mr.has_conflicts === false ? true : null;
    return {
      number: mr.iid,
      title: mr.title,
      baseRef: mr.target_branch,
      headRef: mr.source_branch,
      headSha: mr.sha,
      mergeable,
    };
  }
}

function countDiffLines(diff: string, prefix: '+' | '-'): number {
  if (!diff) return 0;
  let count = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith(prefix) && !line.startsWith(prefix.repeat(3))) count += 1;
  }
  return count;
}

export function collapsePipelineStatus(status: GitLabPipeline['status']): CommitStatus {
  switch (status) {
    case 'success':
    case 'skipped':
    case 'manual':
      return 'green';
    case 'failed':
      return 'red';
    case 'canceled':
      return 'red';
    case 'created':
    case 'waiting_for_resource':
    case 'preparing':
    case 'pending':
    case 'running':
    case 'scheduled':
      return 'pending';
  }
}
