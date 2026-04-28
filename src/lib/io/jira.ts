import { checkIdempotencyMarker } from './idempotency.js';
import { retry } from './retry.js';

export interface JiraComment {
  body: string;
}

export interface PostCommentParams {
  ticketKey: string;
  body: string;
  idempotencyMarker: string;
  recentComments: JiraComment[];
}

export type PostCommentResult =
  | { skipped: true }
  | {
      skipped: false;
      body: string;
    };

/**
 * Thin wrapper: agents should call this module instead of talking to Jira directly.
 *
 * Note: This is intentionally scaffold-only for now. Actual Jira REST calls are
 * deferred to a later story; this function focuses on consistent idempotency
 * and retry wiring.
 */
export async function postComment(params: PostCommentParams): Promise<PostCommentResult> {
  const items = params.recentComments.map((c) => c.body);
  const idempotency = checkIdempotencyMarker(params.idempotencyMarker, items);
  if (idempotency.skipped) return { skipped: true };

  const run = retry(
    async () => {
      // TODO(1-6b): integrate secret scanning before any outbound write.
      // TODO(1-?): replace with real Jira API call.
      return { skipped: false as const, body: params.body };
    },
    { baseDelayMs: 2000, maxAttempts: 3 },
  );

  return run();
}
