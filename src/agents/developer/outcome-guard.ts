import type { DoneOutcome } from '../../lib/llm/agent-loop/types.js';

export interface DevOutcomeOutputs {
  branchPushed: boolean;
  prUrl: string;
  verificationNoteWritten: boolean;
}

/**
 * Pre-comment contract check: asserts all required outputs exist before any
 * terminal Jira comment is posted. Throws if the contract is violated so the
 * action fails closed rather than posting a misleading success comment.
 */
export function assertDevOutputContract(outcome: DoneOutcome, outputs: DevOutcomeOutputs): void {
  if (outcome === 'implemented' || outcome === 'already_satisfied') {
    if (!outputs.branchPushed) {
      throw new Error(
        `Output contract violation: outcome="${outcome}" requires branch to be pushed before posting terminal comment`,
      );
    }
    if (!outputs.prUrl) {
      throw new Error(
        `Output contract violation: outcome="${outcome}" requires a PR URL before posting terminal comment`,
      );
    }
    if (outcome === 'already_satisfied' && !outputs.verificationNoteWritten) {
      throw new Error(
        `Output contract violation: outcome="already_satisfied" requires a verification note to be committed before posting terminal comment`,
      );
    }
  }
  // blocked: label + escalation comment are handled by caller; no positive output check needed
}
