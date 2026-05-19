/**
 * Idempotency-gated effecting steps for the claude-code execution path.
 *
 * These are the deterministic wrapper steps that bracket the
 * `claude-code-action` job (ADR-0006 §2). They perform the Jira-side audit +
 * transition writes the bundled script performs in-process today, but as a
 * non-LLM post-step:
 *
 *   pre-step  : skip if the audit marker is already present (byEventId /
 *               byPrHeadSha + checkIdempotencyMarker — reused verbatim).
 *   post-step : add labels → before-comment transition (FR18/FR28) →
 *               fingerprinted audit comment → after-comment transition (FR24).
 *
 * The audit comment is emitted *here*, by Ferry — never by the LLM (ADR-0004:
 * the Reconciler depends on these markers being deterministic).
 *
 * `ferry:dry-run` suppresses *all* external writes on this path
 * (decisions/0002 §D): the decision is still computed (and logged) but no
 * comment / transition / label is posted.
 */
import { checkIdempotencyMarker, type IdempotencyCheckResult } from '../io/idempotency.js';
import { requireEnv } from '../agent-runtime/env.js';
import type { IssueTracker } from '../io/tracker/types.js';
import type { ContractDecision } from './contract.js';

/**
 * Pre-step + post-step idempotency check. A re-run finds the marker the prior
 * run embedded in its audit comment and skips — same mechanism, same marker
 * format as the script path.
 */
export function checkContractIdempotency(
  marker: string,
  existingComments: string[],
): IdempotencyCheckResult {
  return checkIdempotencyMarker(marker, existingComments);
}

export interface ApplyContractDeps {
  tracker: Pick<IssueTracker, 'postComment' | 'postTransition' | 'addLabel'>;
  ticketKey: string;
  marker: string;
  /** Existing Jira issue comments — scanned for the idempotency marker. */
  existingComments: string[];
  decision: ContractDecision;
  dryRun?: boolean;
  /** Resolves a transition-ID secret. Defaults to `requireEnv` (fail-closed). */
  getEnv?: (key: string) => string;
  logger?: { info: (msg: string, meta?: Record<string, unknown>) => void };
}

export interface ApplyContractResult {
  /** True when a prior run already emitted this marker (no writes performed). */
  skipped: boolean;
  /** True when the audit comment was actually posted. */
  emitted: boolean;
  /** Process exit code parity (1 for `blocked`). */
  exitCode: 0 | 1;
}

/**
 * Performs the idempotency-gated audit + transition writes for one agent run.
 * Pure decision lives in `contract.ts`; this only sequences the IO.
 */
export async function applyContract(deps: ApplyContractDeps): Promise<ApplyContractResult> {
  const { tracker, ticketKey, marker, existingComments, decision, dryRun } = deps;
  const getEnv = deps.getEnv ?? requireEnv;
  const log = deps.logger;

  // ── pre/post idempotency ──────────────────────────────────────────────────
  if (checkIdempotencyMarker(marker, existingComments).skipped) {
    log?.info('cc-wrapper: already processed, skipping', { marker });
    return { skipped: true, emitted: false, exitCode: decision.exitCode };
  }

  // ── dry-run: suppress ALL external writes (decisions/0002 §D) ──────────────
  if (dryRun === true) {
    log?.info('cc-wrapper: DRY_RUN — suppressed audit/transition/label', {
      comment: decision.comment,
      labels: decision.labels,
      transitions: decision.transitions.map((t) => t.transitionIdEnv),
    });
    return { skipped: false, emitted: false, exitCode: decision.exitCode };
  }

  // ── labels (e.g. ferry:blocked) ───────────────────────────────────────────
  for (const label of decision.labels) {
    await tracker.addLabel(ticketKey, label);
  }

  // ── before-comment transitions (FR18 dev / FR28 iterator) ─────────────────
  for (const t of decision.transitions) {
    if (t.when === 'before-comment') {
      await tracker.postTransition(ticketKey, getEnv(t.transitionIdEnv));
    }
  }

  // ── fingerprinted audit comment — emitted by Ferry, never the LLM ─────────
  await tracker.postComment(ticketKey, decision.comment);

  // ── after-comment transitions (FR24 reviewer) ─────────────────────────────
  for (const t of decision.transitions) {
    if (t.when === 'after-comment') {
      await tracker.postTransition(ticketKey, getEnv(t.transitionIdEnv));
    }
  }

  return { skipped: false, emitted: true, exitCode: decision.exitCode };
}
