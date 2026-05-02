import type { EventEnvelopeV1 } from '../../envelope/types.js';

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

export type CommitStatus = 'green' | 'red' | 'pending';

export type DispatchPayload = EventEnvelopeV1;

export interface CIRunner {
  dispatch(phase: string, payload: DispatchPayload): Promise<void>;

  getRepoDefaultBranch(owner: string, repo: string): Promise<string>;

  listPRsForBranch(owner: string, repo: string, branch: string): Promise<PR[]>;
  getPR(prRef: PRRef): Promise<PR>;
  listPRFiles(prRef: PRRef): Promise<PRFile[]>;
  listPRCommits(prRef: PRRef): Promise<Array<{ sha: string; message: string }>>;
  getCommitStatus(owner: string, repo: string, sha: string): Promise<CommitStatus>;
  getFileContent(owner: string, repo: string, path: string, ref: string): Promise<string>;

  createPR(
    owner: string,
    repo: string,
    head: string,
    base: string,
    title: string,
    body: string,
  ): Promise<string>;
  markPRReadyForReview(owner: string, repo: string, prNumber: number): Promise<void>;
  commentOnPR(prRef: PRRef, body: string): Promise<void>;
  addLabelsToPR(prRef: PRRef, labels: string[]): Promise<void>;
  removeLabelFromPR(prRef: PRRef, label: string): Promise<void>;
  listPRComments(prRef: PRRef, count: number): Promise<PRComment[]>;
}
