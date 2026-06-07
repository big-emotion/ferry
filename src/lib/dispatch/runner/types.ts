import type { EventEnvelopeV1 } from '../../envelope/types.js';

/**
 * Identifies a Change Request on a forge. Across forges, "PR" maps to:
 *   - GitHub: pull request
 *   - GitLab: merge request
 *
 * The PR* naming is retained to avoid widespread churn; treat it as
 * forge-neutral in semantics.
 */
export interface PRRef {
  owner: string;
  repo: string;
  prNumber: number;
}

export interface PR {
  number: number;
  title: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  mergeable: boolean | null;
}

export interface PRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface PRComment {
  id: number;
  body: string;
}

/**
 * Aggregated commit status across all checks/pipelines on a commit.
 *
 * Forge-specific semantics:
 *   - GitHub: collapsed from GitHub Checks for the ref. 'green' iff every
 *     check_run has conclusion in {success, neutral, skipped}; 'red' iff any
 *     conclusion is failure/timed_out; 'pending' otherwise.
 *   - GitLab (planned): derived from the latest pipeline status for the ref.
 *     'success' → 'green'; 'failed' → 'red'; 'running'/'pending' → 'pending';
 *     'canceled'/'skipped' → 'green' (treated as non-blocking).
 */
export type CommitStatus = 'green' | 'red' | 'pending';

export type DispatchPayload = EventEnvelopeV1;

/**
 * Forge-neutral adapter surface used by every agent.
 *
 * Implementations live in `src/lib/dispatch/runner/<forge>/`. Production code
 * must resolve a runner through `createRunnerFromEnv()` (see `./factory.ts`),
 * never by instantiating a concrete implementation. Tests that need to inject
 * mock HTTP clients may construct the concrete adapter directly.
 */
export interface CIRunner {
  /**
   * Trigger the next phase on this forge. On GitHub this fires a
   * `repository_dispatch` event; on GitLab this triggers a pipeline.
   */
  dispatch(phase: string, payload: DispatchPayload): Promise<void>;

  getRepoDefaultBranch(owner: string, repo: string): Promise<string>;

  listPRsForBranch(owner: string, repo: string, branch: string): Promise<PR[]>;
  getPR(prRef: PRRef): Promise<PR>;
  listPRFiles(prRef: PRRef): Promise<PRFile[]>;
  listPRCommits(prRef: PRRef): Promise<Array<{ sha: string; message: string }>>;
  /**
   * Aggregated check/pipeline status for a commit. See {@link CommitStatus}
   * for forge-specific collapse rules.
   */
  getCommitStatus(owner: string, repo: string, sha: string): Promise<CommitStatus>;
  getFileContent(owner: string, repo: string, path: string, ref: string): Promise<string>;

  /**
   * Open a draft PR (GitHub) / WIP MR (GitLab). Implementations must be
   * idempotent: if an open PR for `head` already exists, return its URL.
   */
  createPR(
    owner: string,
    repo: string,
    head: string,
    base: string,
    title: string,
    body: string,
    options?: { draft?: boolean },
  ): Promise<string>;
  /**
   * Promote draft → ready-for-review (GitHub) or remove `Draft:` prefix from
   * MR title (GitLab).
   */
  markPRReadyForReview(owner: string, repo: string, prNumber: number): Promise<void>;
  commentOnPR(prRef: PRRef, body: string): Promise<void>;
  addLabelsToPR(prRef: PRRef, labels: string[]): Promise<void>;
  removeLabelFromPR(prRef: PRRef, label: string): Promise<void>;
  listPRComments(prRef: PRRef, count: number): Promise<PRComment[]>;
  /**
   * Merge a pull request using the specified strategy.
   * Throws if the PR is not mergeable or the merge fails.
   */
  mergePR(
    prRef: PRRef,
    strategy: 'squash' | 'merge' | 'rebase',
    commitTitle?: string,
  ): Promise<void>;
}
