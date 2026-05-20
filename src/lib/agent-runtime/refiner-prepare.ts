/**
 * Refiner role pre-loop setup (issue #330).
 *
 * Extracted from `src/agents/refiner/refiner-action.ts` so the same setup feeds
 * both the script path and the future cc-prepare composite (sister issue #331).
 *
 * Unlike the developer / iterator / reviewer roles, the refiner does not invoke
 * `createAgentLoop` — it runs a single LLM JSON-mode call via `runRefiner`. The
 * prepared context here therefore exposes the *inputs* to `runRefiner` (issue,
 * existingSubtasks, priorRefinerRuns, runLink) plus the idempotency marker,
 * rather than the `system` / `initialPrompt` / `mcpServers` triple used by the
 * agent-loop roles.
 */

import type { EventEnvelopeV1 } from '../envelope/types.js';
import type { IssueTracker, TrackerIssue, TrackerSubtask } from '../io/tracker/types.js';
import { byEventId } from './idempotency.js';

const PRIOR_RUN_MARKER = /\[ferry:refiner:[^\]]+\]/;

export interface PrepareRefinerInput {
  envelope: EventEnvelopeV1;
  tracker: IssueTracker;
}

export interface RefinerPreparedContext {
  issue: TrackerIssue;
  existingSubtasks: TrackerSubtask[];
  priorRefinerRuns: string[];
  runLink: string;
  idempotencyMarker: string;
}

export async function prepareRefiner(input: PrepareRefinerInput): Promise<RefinerPreparedContext> {
  const { envelope, tracker } = input;
  const { ticket_key: ticketKey, event_id: eventId } = envelope;

  const issue = await tracker.getIssue(ticketKey);
  const existingSubtasks = await tracker.getSubtaskDetails(ticketKey);
  const priorRefinerRuns = issue.comments.filter((c) => PRIOR_RUN_MARKER.test(c));
  const runLink = `https://github.com/${process.env.GITHUB_REPO ?? 'unknown'}/actions/runs/${process.env.GITHUB_RUN_ID ?? '0'}`;
  const idempotencyMarker = byEventId('refiner', eventId);

  return {
    issue,
    existingSubtasks,
    priorRefinerRuns,
    runLink,
    idempotencyMarker,
  };
}
