/**
 * Mandated TL;DR block in PR body (FR55).
 *
 * Six-field markdown table inside `<!-- ferry:tldr -->` markers, written by
 * the Developer and refreshed by the Iterator. Total length capped at 500
 * chars. The Reviewer updates only the verdict field.
 */

import { FerryError } from '../error.js';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface TldrInput {
  ships: string;
  touches_files: number;
  touches_lines: number;
  risk_level: RiskLevel;
  risk_justification: string;
  tests: string;
  rollback: string;
  reviewer_verdict: string;
}

export const TLDR_OPEN = '<!-- ferry:tldr -->';
export const TLDR_CLOSE = '<!-- /ferry:tldr -->';
export const TLDR_MAX_LEN = 500;
export const TLDR_MAX_VERDICT_LEN = 40;
/** Cap for the Risk cell value: "<level> \u2014 <justification>" — covers the longest level prefix 'medium \u2014 ' (9 chars) plus an 80-char justification. */
export const TLDR_RISK_CELL_MAX = 89;

export const TLDR_FIELD_ORDER = [
  'Ships',
  'Touches',
  'Risk',
  'Tests',
  'Rollback',
  'Reviewer verdict',
] as const;

function escCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function buildTldrBlock(input: TldrInput): string {
  const risk = `${input.risk_level} — ${input.risk_justification}`.slice(0, TLDR_RISK_CELL_MAX);
  const touches = `${input.touches_files} files / +${input.touches_lines}`;
  const lines: string[] = [];
  lines.push(TLDR_OPEN);
  lines.push('### TL;DR for the human merger');
  lines.push('| Field | Value |');
  lines.push('|---|---|');
  lines.push(`| Ships | ${escCell(input.ships)} |`);
  lines.push(`| Touches | ${escCell(touches)} |`);
  lines.push(`| Risk | ${escCell(risk)} |`);
  lines.push(`| Tests | ${escCell(input.tests)} |`);
  lines.push(`| Rollback | ${escCell(input.rollback)} |`);
  lines.push(
    `| Reviewer verdict | ${escCell(input.reviewer_verdict.slice(0, TLDR_MAX_VERDICT_LEN))} |`,
  );
  lines.push(TLDR_CLOSE);
  const block = lines.join('\n');
  if (block.length > TLDR_MAX_LEN) {
    throw new FerryError('state-invariant', {
      reason: 'tldr-too-long',
      length: block.length,
      max: TLDR_MAX_LEN,
    });
  }
  return block;
}

const ESC_OPEN = TLDR_OPEN.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
const ESC_CLOSE = TLDR_CLOSE.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
export const TLDR_SLOT = new RegExp(`${ESC_OPEN}[\\s\\S]*?${ESC_CLOSE}`);

export function upsertTldrInBody(body: string, input: TldrInput): string {
  const block = buildTldrBlock(input);
  if (TLDR_SLOT.test(body)) return body.replace(TLDR_SLOT, block);
  if (body.length === 0) return block;
  // Always emit exactly one blank line between the TL;DR block and the existing body,
  // regardless of whether the body already had a leading newline.
  const trimmed = body.replace(/^\n+/, '');
  return `${block}\n\n${trimmed}`;
}

export function updateReviewerVerdictField(body: string, verdict: string): string {
  const truncated = verdict.slice(0, TLDR_MAX_VERDICT_LEN);
  const re = /\| Reviewer verdict \| (.+?) \|/;
  if (!re.test(body)) return body;
  return body.replace(re, `| Reviewer verdict | ${escCell(truncated)} |`);
}
