/**
 * HTTP-status classifier and pause-directive builder for provider rate-limit
 * and budget-exhaustion responses (FR46, NFR-R4). Ticket-scoped: we never
 * pause globally, only the affected ticket.
 */

export type HttpClass = 'ok' | 'transient' | 'spend-cap';

export function classifyHttpStatus(status: number): HttpClass {
  if (status === 429 || status === 402) return 'spend-cap';
  if (status >= 500) return 'transient';
  if (status >= 200 && status < 300) return 'ok';
  // 4xx other than the above is non-retryable but not a spend-cap; treat as
  // unknown (caller should error out, not auto-pause).
  if (status >= 400) return 'spend-cap';
  return 'transient';
}

export interface SpendCapPauseInput {
  ticket_key: string;
  role: 'refiner' | 'developer' | 'reviewer' | 'iterator';
  run_id: string;
}

export interface SpendCapPauseDirective {
  ticket_key: string;
  add_labels: string[];
  jira_comment: string;
  audit_outcome: 'spend-cap';
}

export function buildSpendCapPause(input: SpendCapPauseInput): SpendCapPauseDirective {
  return {
    ticket_key: input.ticket_key,
    add_labels: ['ferry:paused', 'ferry:spend-cap'],
    jira_comment: `[ferry:${input.role}:${input.run_id}] Paused — provider rate limit hit. Resume manually when resolved.`,
    audit_outcome: 'spend-cap',
  };
}
