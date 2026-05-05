import type { DoneOutcome } from '../../lib/llm/agent-loop/types.js';

export interface IterOutcomeOutputs {
  branchPushed: boolean;
  prNumber: number;
}

/**
 * Pre-comment contract check for the iterator agent. Throws if required outputs
 * are missing so the action fails closed rather than posting a misleading comment.
 */
export function assertIterOutputContract(outcome: DoneOutcome, outputs: IterOutcomeOutputs): void {
  if (outcome === 'implemented' || outcome === 'already_satisfied') {
    if (!outputs.branchPushed) {
      throw new Error(
        `Output contract violation: outcome="${outcome}" requires branch to be pushed before posting terminal comment`,
      );
    }
    if (!outputs.prNumber) {
      throw new Error(
        `Output contract violation: outcome="${outcome}" requires an open PR before posting terminal comment`,
      );
    }
  }
  // blocked: label + escalation comment handled by caller
}
