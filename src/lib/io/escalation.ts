/**
 * Escalation summary block written to the PR body whenever a ticket is
 * escalated to needs-human (FR59). Five required sections plus optional
 * Context. Wrapped in `<!-- ferry:escalation -->` markers so re-writes are
 * idempotent and the block can be cleared on successful re-run.
 *
 * Pure logic: the actual GitHub PR-body update is performed by the caller
 * via the IO wrapper layer; this module only builds, replaces, and clears
 * the block within a string.
 */

import { FerryError } from '../error.js';

export interface EscalationFinding {
  rule_id: string;
  message: string;
  file?: string;
  line_start?: number;
  line_end?: number;
}

export interface EscalationInput {
  what_i_tried: string[];
  what_blocked_me: EscalationFinding[];
  hypothesis: string;
  next_action: string;
  context?: string;
}

const OPEN = '<!-- ferry:escalation -->';
const CLOSE = '<!-- /ferry:escalation -->';
const MAX_BULLET_LEN = 120;
const MAX_HYPOTHESIS_LEN = 400;

function validate(input: EscalationInput): void {
  if (input.what_i_tried.length < 2 || input.what_i_tried.length > 5) {
    throw new FerryError('state-invariant', {
      reason: 'escalation-tried-bullet-count',
      count: input.what_i_tried.length,
    });
  }
  for (const b of input.what_i_tried) {
    if (b.length === 0 || b.length > MAX_BULLET_LEN) {
      throw new FerryError('state-invariant', {
        reason: 'escalation-tried-bullet-length',
        max: MAX_BULLET_LEN,
        actual: b.length,
      });
    }
  }
  if (input.what_blocked_me.length < 1) {
    throw new FerryError('state-invariant', {
      reason: 'escalation-blocked-empty',
    });
  }
  if (input.hypothesis.length === 0 || input.hypothesis.length > MAX_HYPOTHESIS_LEN) {
    throw new FerryError('state-invariant', {
      reason: 'escalation-hypothesis-length',
      max: MAX_HYPOTHESIS_LEN,
      actual: input.hypothesis.length,
    });
  }
  if (input.next_action.length === 0) {
    throw new FerryError('state-invariant', {
      reason: 'escalation-next-action-empty',
    });
  }
}

function renderFinding(f: EscalationFinding): string {
  const loc =
    f.file && f.line_start
      ? `${f.file}:${f.line_start}-${f.line_end ?? f.line_start}`
      : (f.file ?? '');
  return `- \`${f.rule_id}\` ${loc} — ${f.message}`;
}

export function buildEscalationBlock(input: EscalationInput): string {
  validate(input);
  const lines: string[] = [];
  lines.push(OPEN);
  lines.push('### 🚨 Escalation Summary — human attention needed');
  lines.push('');
  lines.push('**What I tried**');
  for (const b of input.what_i_tried) lines.push(`- ${b}`);
  lines.push('');
  lines.push('**What blocked me**');
  for (const f of input.what_blocked_me) lines.push(renderFinding(f));
  lines.push('');
  lines.push('**My best hypothesis**');
  lines.push(input.hypothesis);
  lines.push('');
  lines.push('**Suggested next action for you**');
  lines.push(input.next_action);
  if (input.context && input.context.trim().length > 0) {
    lines.push('');
    lines.push('**Context**');
    lines.push(input.context);
  }
  lines.push(CLOSE);
  return lines.join('\n');
}

const ESC_OPEN = OPEN.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
const ESC_CLOSE = CLOSE.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
const SLOT = new RegExp(`${ESC_OPEN}[\\s\\S]*?${ESC_CLOSE}`);

export function writeEscalationToBody(body: string, input: EscalationInput): string {
  const block = buildEscalationBlock(input);
  if (SLOT.test(body)) return body.replace(SLOT, block);
  const sep = body.length > 0 && !body.endsWith('\n') ? '\n\n' : '\n';
  return `${body}${sep}${block}\n`;
}

export function clearEscalationFromBody(body: string): string {
  if (!SLOT.test(body)) return body;
  return body.replace(SLOT, '').replace(/\n{3,}/g, '\n\n');
}
