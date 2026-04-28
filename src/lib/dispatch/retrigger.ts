/**
 * Re-trigger envelope builder for label and @mention dispatches.
 *
 * Wraps user-supplied @mention instructions via `delimitUntrusted()` so the
 * agent prompt cannot be hijacked by adversarial prompt injection (NFR-S1).
 * Caller is responsible for minting a fresh ULID for `event_id` so re-triggers
 * are not blocked by the dedupe ledger.
 */

import { delimitUntrusted } from '../sanitization/delimit-untrusted.js';

export type RetriggerSource = 'jira-label' | 'jira-mention';
export type RetriggerPhase = 'refine' | 'dev' | 'review' | 'iterate';

export interface RetriggerEnvelopeInput {
  source: RetriggerSource;
  ticket_key: string;
  phase: RetriggerPhase;
  ticket_type: string;
  event_id: string;
  instructions?: string;
}

export interface RetriggerEnvelope {
  source: RetriggerSource;
  ticket_key: string;
  phase: RetriggerPhase;
  ticket_type: string;
  event_id: string;
  instructions?: string;
}

export function buildRetriggerEnvelope(input: RetriggerEnvelopeInput): RetriggerEnvelope {
  const env: RetriggerEnvelope = {
    source: input.source,
    ticket_key: input.ticket_key,
    phase: input.phase,
    ticket_type: input.ticket_type,
    event_id: input.event_id,
  };
  if (input.instructions && input.instructions.trim().length > 0) {
    env.instructions = delimitUntrusted(input.instructions.trim());
  }
  return env;
}
