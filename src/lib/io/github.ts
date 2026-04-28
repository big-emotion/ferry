import { checkIdempotencyMarker } from './idempotency.js';
import { retry } from './retry.js';

export interface GitHubComment {
  body: string;
}

export interface CreateIssueCommentParams {
  repo: string;
  issueNumber: number;
  body: string;
  idempotencyMarker: string;
  recentComments: GitHubComment[];
}

export type CreateIssueCommentResult =
  | { skipped: true }
  | {
      skipped: false;
      body: string;
    };

/**
 * Thin wrapper: agents should call this module instead of importing Octokit directly.
 *
 * Note: This is intentionally scaffold-only for now. Actual GitHub REST calls are
 * deferred to a later story; this function focuses on consistent idempotency
 * and retry wiring.
 */
export async function createIssueComment(
  params: CreateIssueCommentParams,
): Promise<CreateIssueCommentResult> {
  const items = params.recentComments.map((c) => c.body);
  const idempotency = checkIdempotencyMarker(params.idempotencyMarker, items);
  if (idempotency.skipped) return { skipped: true };

  const run = retry(
    async () => {
      // TODO(1-6b): integrate secret scanning before any outbound write.
      // TODO(1-?): replace with real GitHub API call.
      return { skipped: false as const, body: params.body };
    },
    { baseDelayMs: 2000, maxAttempts: 3 },
  );

  return run();
}
