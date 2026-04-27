import { FerryError } from '../error.js';

export interface ErrorMapping {
  labels: string[];
  outcome: string;
  jiraCommentTemplate: string;
}

export function mapError(e: unknown): ErrorMapping {
  const code = e instanceof FerryError ? e.code : 'unknown';
  const contextStr =
    e instanceof FerryError && e.context ? ` Context: ${JSON.stringify(e.context)}` : '';

  switch (code) {
    case 'transient':
      return {
        labels: [],
        outcome: 'transient',
        jiraCommentTemplate:
          '[ferry:{role}:{runId}] Retrying — transient error. Check GHA run for details.',
      };
    case 'spend-cap':
      return {
        labels: ['ferry:paused', 'ferry:spend-cap'],
        outcome: 'spend-cap',
        jiraCommentTemplate:
          '[ferry:{role}:{runId}] Paused — spend cap or provider rate limit reached. Resolve billing issue and remove ferry:paused to resume.',
      };
    case 'state-invariant':
      return {
        labels: ['status:stale'],
        outcome: 'state-invariant',
        jiraCommentTemplate:
          '[ferry:{role}:{runId}] Aborted — stale state detected. Re-dispatch to resume.',
      };
    case 'oscillation':
      return {
        labels: ['needs-human'],
        outcome: 'oscillation',
        jiraCommentTemplate:
          '[ferry:{role}:{runId}] Escalated — oscillation detected (same finding resurfaced). See PR for details.',
      };
    default:
      return {
        labels: ['needs-human'],
        outcome: 'unknown',
        jiraCommentTemplate: `[ferry:{role}:{runId}] Unexpected error — human triage required. See GHA run: {runUrl}${contextStr}`,
      };
  }
}
