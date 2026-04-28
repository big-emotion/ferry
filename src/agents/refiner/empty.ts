/**
 * Story 3-3: empty / unactionable ticket detection (FR11).
 */

const MIN_WORDS = 5;
const PLACEHOLDER_RE = /^(n\/a|tbd|todo|wip|\?+|-)$/i;

export interface EmptyClassification {
  unactionable: boolean;
  reason?: 'empty' | 'too-short' | 'placeholder';
}

export function classifyEmptyTicket(description: string): EmptyClassification {
  const trimmed = description.trim();
  if (trimmed.length === 0) return { unactionable: true, reason: 'empty' };
  if (PLACEHOLDER_RE.test(trimmed)) return { unactionable: true, reason: 'placeholder' };
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS) return { unactionable: true, reason: 'too-short' };
  return { unactionable: false };
}

export interface EmptyCommentInput {
  runId: string;
}

export function formatEmptyTicketComment(input: EmptyCommentInput): string {
  return `[ferry:refiner:${input.runId}] Cannot plan — ticket description is empty or unactionable. Please add requirements and re-trigger.`;
}

export interface ReadyCommentInput {
  runId: string;
  subtaskCount: number;
}

export function formatRefinerReadyComment(input: ReadyCommentInput): string {
  return `[ferry:refiner:${input.runId}] Refinement complete — ${input.subtaskCount} sub-tasks created. Move the ticket to Ready for Dev when reviewed.`;
}
