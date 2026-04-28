/**
 * Cancel-recovery detector. After a workflow is cancelled mid-write the next
 * run must detect inconsistent state (HEAD-SHA mismatch or schema invalid),
 * label the ticket `status:stale`, and exit without writes (FR34).
 */

export interface CancelRecoveryInput {
  stored_pr_sha?: string;
  current_head_sha: string;
  schema_ok: boolean;
}

export interface CancelRecoveryOutcome {
  stale: boolean;
  add_labels: string[];
  exit_without_writes: boolean;
}

export function detectStaleAfterCancel(input: CancelRecoveryInput): CancelRecoveryOutcome {
  const shaMismatch =
    input.stored_pr_sha !== undefined && input.stored_pr_sha !== input.current_head_sha;
  const stale = !input.schema_ok || shaMismatch;
  if (!stale) {
    return { stale: false, add_labels: [], exit_without_writes: false };
  }
  return {
    stale: true,
    add_labels: ['status:stale'],
    exit_without_writes: true,
  };
}
