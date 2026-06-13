import { loadFerryConfig } from '../../lib/config.js';
import { buildLocalEnvelope } from './envelope.js';
import { LocalIdempotencyStore } from './idempotency.js';
import { runLocalPhase } from './run-phase.js';
import { ensureTicketWorktree, getTicketWorktreePlan } from './worktree.js';

export interface ProcessLocalTransitionInput {
  repoRoot: string;
  ticketKey: string;
  status: string;
  ts?: string;
  eventId?: string;
  dryRun?: boolean;
}

export async function processLocalTransition(input: ProcessLocalTransitionInput): Promise<void> {
  const config = loadFerryConfig(input.repoRoot);
  const envelope = buildLocalEnvelope({
    ticketKey: input.ticketKey,
    status: input.status,
    ts: input.ts ?? new Date().toISOString(),
    eventId: input.eventId,
    workflow: config.workflow,
  });

  const idempotency = new LocalIdempotencyStore(input.repoRoot);
  if (!idempotency.markIfUnseen(input.ticketKey, envelope.event_id)) {
    console.log(
      `[ferry-local] skip duplicate ${input.ticketKey} (${envelope.phase}, ${envelope.event_id})`,
    );
    return;
  }

  if (input.dryRun) {
    const plan = getTicketWorktreePlan(input.repoRoot, input.ticketKey);
    console.log(
      JSON.stringify(
        {
          envelope,
          branch: plan.branch,
          worktreePath: plan.worktreePath,
        },
        null,
        2,
      ),
    );
    runLocalPhase({
      repoRoot: input.repoRoot,
      worktreePath: plan.worktreePath,
      envelope,
      dryRun: true,
    });
    return;
  }

  const worktree = ensureTicketWorktree({
    repoRoot: input.repoRoot,
    ticketKey: input.ticketKey,
    baseBranch: config.git.base_branch,
  });

  runLocalPhase({
    repoRoot: input.repoRoot,
    worktreePath: worktree.worktreePath,
    envelope,
  });
}
