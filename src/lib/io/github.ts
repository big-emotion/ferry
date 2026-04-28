import { checkIdempotencyMarker } from './idempotency.js';
import { retry } from './retry.js';
import {
  writeEscalationToBody,
  clearEscalationFromBody,
  type EscalationInput,
} from './escalation.js';

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

export interface UpdatePrBodyParams {
  repo: string;
  prNumber: number;
  body: string;
}

export interface UpdatePrBodyResult {
  body: string;
}

/**
 * Thin wrapper that updates a PR body with retry/secret-scanning hooks.
 *
 * Note: scaffold-only; the real REST call is wired in a later story. This
 * function exists so the escalation builder has a documented integration
 * point on the GitHub IO layer (FR59 / story 6-4 AC2).
 */
export async function updatePrBody(params: UpdatePrBodyParams): Promise<UpdatePrBodyResult> {
  const run = retry(
    async () => {
      // TODO(1-6b): integrate secret scanning before any outbound write.
      // TODO: replace with real GitHub PATCH /repos/{owner}/{repo}/pulls/{prNumber}.
      return { body: params.body };
    },
    { baseDelayMs: 2000, maxAttempts: 3 },
  );

  return run();
}

/**
 * Writes an escalation block into a PR body and persists it via the GitHub
 * IO wrapper. Idempotent across re-runs (the block is bounded by markers).
 */
export async function writeEscalationToPrBody(params: {
  repo: string;
  prNumber: number;
  currentBody: string;
  escalation: EscalationInput;
}): Promise<UpdatePrBodyResult> {
  const nextBody = writeEscalationToBody(params.currentBody, params.escalation);
  return updatePrBody({
    repo: params.repo,
    prNumber: params.prNumber,
    body: nextBody,
  });
}

/**
 * Clears any escalation block from a PR body and persists it. No-op write
 * when the body has no marker region.
 */
export async function clearEscalationFromPrBody(params: {
  repo: string;
  prNumber: number;
  currentBody: string;
}): Promise<UpdatePrBodyResult> {
  const nextBody = clearEscalationFromBody(params.currentBody);
  return updatePrBody({
    repo: params.repo,
    prNumber: params.prNumber,
    body: nextBody,
  });
}
