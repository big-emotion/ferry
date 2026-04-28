/**
 * Reviewer CI-status gate.
 *
 * Pure function that maps a CI status into a deterministic outcome before any
 * LLM call. Pending exits silently; red posts a synthetic finding; green
 * proceeds to the real review path. No IO is performed here — the caller
 * (review.yml) wires this into github/jira side effects.
 */

export type CiStatus = 'pending' | 'green' | 'red';

export interface ReviewerFinding {
  rule_id: string;
  message: string;
  file?: string;
  line_start?: number;
  line_end?: number;
}

export interface CiGateInput {
  status: CiStatus;
  /** Failure summary for red CI; ignored otherwise. */
  failure_summary?: string;
}

export interface CiGateOutcome {
  outcome: 'pending-ci' | 'ci-red' | 'ci-green';
  proceed: boolean;
  findings: ReviewerFinding[];
  next_state?: 'changes-requested';
  tokens: { input: number; output: number };
  cost_eur: number;
}

const DEFAULT_RED_MESSAGE = 'CI checks failed for this PR. See the failed Actions run for details.';

export function gateCi(input: CiGateInput): CiGateOutcome {
  if (input.status === 'pending') {
    return {
      outcome: 'pending-ci',
      proceed: false,
      findings: [],
      tokens: { input: 0, output: 0 },
      cost_eur: 0,
    };
  }

  if (input.status === 'red') {
    const message = (input.failure_summary ?? '').trim() || DEFAULT_RED_MESSAGE;
    return {
      outcome: 'ci-red',
      proceed: false,
      findings: [{ rule_id: 'ci-failure', message }],
      next_state: 'changes-requested',
      tokens: { input: 0, output: 0 },
      cost_eur: 0,
    };
  }

  return {
    outcome: 'ci-green',
    proceed: true,
    findings: [],
    tokens: { input: 0, output: 0 },
    cost_eur: 0,
  };
}
