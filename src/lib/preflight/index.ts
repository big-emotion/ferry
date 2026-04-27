import { FerryError } from '../error.js';
import { loadState } from '../state/index.js';
import type { FerryPhase } from '../state/types.js';

export interface PreflightEnvelope {
  ticket_key: string;
  phase: string;
}

export interface PreflightDeps {
  branchExists: (branch: string) => Promise<boolean>;
  getPrState: (prNumber: number) => Promise<'open' | 'closed' | 'merged'>;
  getHeadSha: () => Promise<string>;
  getJiraColumn: (ticketKey: string) => Promise<string>;
}

export const PHASE_TO_JIRA_COLUMN: Record<FerryPhase, string> = {
  refining: 'Refinement',
  developing: 'In Development',
  reviewing: 'In Review',
  iterating: 'Changes Requested',
  ready: 'Ready to Merge',
  paused: 'Paused',
  cancelled: 'Cancelled',
  'needs-human': 'Needs Human',
};

export async function preflight(
  envelope: PreflightEnvelope,
  deps: PreflightDeps,
  stateDir: string = process.cwd(),
): Promise<void> {
  const branch = `ferry/${envelope.ticket_key}`;
  const branchOk = await deps.branchExists(branch);
  if (!branchOk) {
    throw new FerryError('state-invariant', {
      reason: 'branch does not exist',
      branch,
    });
  }

  const state = await loadState({ ticket_key: envelope.ticket_key }, stateDir);

  if (state?.pr_number !== undefined) {
    const prState = await deps.getPrState(state.pr_number);
    if (prState !== 'open') {
      throw new FerryError('state-invariant', {
        reason: 'PR is not open',
        pr_state: prState,
      });
    }
  }

  if (state?.pr_sha !== undefined) {
    const headSha = await deps.getHeadSha();
    if (headSha !== state.pr_sha) {
      throw new FerryError('state-invariant', { reason: 'HEAD SHA mismatch' });
    }
  }

  // TODO (Story 2.x): envelope.phase uses event-phase vocabulary ('refine', 'dev'…) but
  // PHASE_TO_JIRA_COLUMN is keyed on state-phase vocabulary ('refining', 'developing'…).
  // When preflight is wired to real dispatches, use the loaded state's phase for this lookup
  // instead of envelope.phase — the state tells you where the ticket currently is.
  const expectedColumn = PHASE_TO_JIRA_COLUMN[envelope.phase as FerryPhase];
  if (expectedColumn !== undefined) {
    const actualColumn = await deps.getJiraColumn(envelope.ticket_key);
    if (actualColumn !== expectedColumn) {
      throw new FerryError('state-invariant', { reason: 'Jira column mismatch' });
    }
  }
}
