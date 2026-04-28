/**
 * HTTP-status classifier and pause-directive builder for provider rate-limit
 * and budget-exhaustion responses (FR46, NFR-R4). Ticket-scoped: we never
 * pause globally, only the affected ticket.
 */

export type HttpClass = 'ok' | 'transient' | 'spend-cap' | 'unknown';

export function classifyHttpStatus(status: number): HttpClass {
  // 429 (rate-limit) and 402 (payment required) are the only auto-pause signals.
  if (status === 429 || status === 402) return 'spend-cap';
  // 5xx — retry with backoff.
  if (status >= 500) return 'transient';
  // 2xx — success.
  if (status >= 200 && status < 300) return 'ok';
  // Other 4xx (400/401/403/404/...) is non-retryable but NOT a spend-cap.
  // Caller must surface the error, not auto-pause the ticket.
  if (status >= 400) return 'unknown';
  // 1xx and 3xx — not expected from provider APIs but we don't auto-pause on them either.
  return 'unknown';
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
