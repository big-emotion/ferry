/**
 * Reviewer verdict — three-field structured summary for the PR body.
 *
 * Decision is `merge-ready` | `changes-requested` | `needs-human`. The verdict
 * is written into a delimited bot-owned slot in the PR body so subsequent
 * runs replace it idempotently. Total word count is capped at 120 (NFR-UX3).
 */

import type { ReviewerFinding } from './schema.js';

export type ReviewerDecision = 'merge-ready' | 'changes-requested' | 'needs-human';

export interface ReviewerVerdict {
  decision: ReviewerDecision;
  'top-risk': string;
  'reading-time-estimate': number;
}

export class ReviewerVerdictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewerVerdictError';
  }
}

const MAX_WORDS = 120;
const VERDICT_OPEN = '<!-- ferry:reviewer-verdict -->';
const VERDICT_CLOSE = '<!-- /ferry:reviewer-verdict -->';

export function countWords(s: string): number {
  return s
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0).length;
}

export interface BuildVerdictInput {
  findings: ReviewerFinding[];
  /** Total changed lines in the diff; used for the reading-time estimate. */
  diffLines: number;
}

/** Estimate reading time (minutes) at ~50 changed lines per minute, min 1. */
function estimateReadingTime(diffLines: number): number {
  return Math.max(1, Math.ceil(Math.max(0, diffLines) / 50));
}

export function buildVerdict(input: BuildVerdictInput): ReviewerVerdict {
  if (input.findings.length === 0) {
    return {
      decision: 'merge-ready',
      'top-risk': 'none',
      'reading-time-estimate': estimateReadingTime(input.diffLines),
    };
  }
  const blockers = input.findings.filter((f) => f.rule_id === 'ci-failure');
  const top = blockers[0] ?? input.findings[0];
  return {
    decision: 'changes-requested',
    'top-risk': `${top.rule_id}: ${top.message}`,
    'reading-time-estimate': estimateReadingTime(input.diffLines),
  };
}

function totalWords(v: ReviewerVerdict): number {
  return (
    countWords(v.decision) +
    countWords(v['top-risk']) +
    countWords(String(v['reading-time-estimate']))
  );
}

export function truncateVerdict(v: ReviewerVerdict): ReviewerVerdict {
  if (totalWords(v) > MAX_WORDS) {
    throw new ReviewerVerdictError(`verdict exceeds ${MAX_WORDS}-word cap (NFR-UX3)`);
  }
  return v;
}

function renderVerdictBlock(v: ReviewerVerdict): string {
  return [
    VERDICT_OPEN,
    `decision: ${v.decision}`,
    `top-risk: ${v['top-risk']}`,
    `reading-time-estimate: ${v['reading-time-estimate']}`,
    VERDICT_CLOSE,
  ].join('\n');
}

export function writeVerdictToBody(body: string, v: ReviewerVerdict): string {
  truncateVerdict(v);
  const block = renderVerdictBlock(v);
  const escapedOpen = VERDICT_OPEN.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
  const escapedClose = VERDICT_CLOSE.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
  const slot = new RegExp(`${escapedOpen}[\\s\\S]*?${escapedClose}`);
  if (slot.test(body)) return body.replace(slot, block);
  const sep = body.length > 0 && !body.endsWith('\n') ? '\n\n' : '\n';
  return `${body}${sep}${block}\n`;
}
