/**
 * Deterministic contract decision for the claude-code execution path.
 *
 * Given a validated terminal agent artifact (see `agent-output.ts`) plus the
 * resolved gating flags, this **pure** function reproduces — byte-for-byte —
 * the audit comment, Jira labels, terminal exit code, and FR18/FR24/FR28
 * transition plan the bundled script path emits today
 * (`src/agents/{developer,iterator,reviewer,refiner}/*-action.ts`).
 *
 * Acceptance contract (#301): audit markers and transitions must be
 * byte-identical to the script path so the Reconciler (ADR-0004) is
 * unaffected. This module owns the *decision*; `apply.ts` performs the
 * idempotency-gated IO. The LLM never produces audit markers or transitions.
 */
import { byEventId, byPrHeadSha } from '../agent-runtime/idempotency.js';
import { FerryError } from '../errors/index.js';
import type { AgentOutputRole, AgentOutputV1 } from './agent-output.js';

export type TransitionIdEnv =
  | 'FERRY_REVIEW_TRANSITION_ID'
  | 'FERRY_ITER_TRANSITION_ID'
  | 'FERRY_APPROVE_TRANSITION_ID';

export interface TransitionPlan {
  /** Transition-ID secret to require + post (reused install-time secrets). */
  transitionIdEnv: TransitionIdEnv;
  /**
   * Ordering relative to the audit comment. The script path posts the FR18
   * (dev) / FR28 (iterator) transition *before* the terminal Jira comment,
   * and the FR24 (reviewer) transition *after* it — preserved here.
   */
  when: 'before-comment' | 'after-comment';
}

export interface ContractDecision {
  /** Full audit comment body, marker-prefixed (`[ferry:<role>:<run-id>] …`). */
  comment: string;
  /** Jira labels to add (e.g. `ferry:blocked`). */
  labels: string[];
  /** FR18 / FR24 / FR28 transition plan (empty when none applies). */
  transitions: TransitionPlan[];
  /**
   * Optional GitHub PR body (reviewer `review_comment`). Surfaced as
   * pass-through metadata for the action job (#302) — `apply.ts` only
   * performs the Jira-side audit/transition writes this issue (#301) owns.
   */
  prComment?: string;
  /** Process exit code parity: 1 for `blocked`, else 0. */
  exitCode: 0 | 1;
}

export interface MarkerContext {
  eventId: string;
  /** Developer keys on the branch head SHA when known, else the event id. */
  branchHeadSha?: string;
  /** Iterator + reviewer key on the PR head SHA. */
  prHeadSha?: string;
}

export interface ContractContext {
  marker: string;
  gates: {
    /** Developer FR18 / iterator FR28 auto-transition gate. */
    shouldAutoTransition?: boolean;
    noAutoTransition?: boolean;
    /** Reviewer FR24 approve gate. */
    shouldTransitionApprove?: boolean;
    /** Reviewer FR24 changes gate. */
    shouldTransitionChanges?: boolean;
  };
  prUrl?: string;
  prNumber?: number;
  priorIterations?: number;
  cap?: number;
}

/** Marker role token. Developer uses `dev` (script parity), others = role. */
export function markerRoleToken(role: AgentOutputRole): string {
  return role === 'developer' ? 'dev' : role;
}

/**
 * Computes the byte-identical idempotency / audit marker for `role`, matching
 * the per-agent keying the script path uses:
 *  - developer → branch head SHA (7) when known, else event id; token `dev`
 *  - iterator  → PR head SHA (7)
 *  - reviewer  → PR head SHA (7)
 *  - refiner   → event id
 */
export function resolveContractMarker(role: AgentOutputRole, ctx: MarkerContext): string {
  switch (role) {
    case 'developer':
      return ctx.branchHeadSha
        ? byPrHeadSha('dev', ctx.branchHeadSha)
        : byEventId('dev', ctx.eventId);
    case 'iterator':
      if (!ctx.prHeadSha)
        throw new FerryError('state-invariant', { reason: 'missing-context', need: 'prHeadSha' });
      return byPrHeadSha('iterator', ctx.prHeadSha);
    case 'reviewer':
      if (!ctx.prHeadSha)
        throw new FerryError('state-invariant', { reason: 'missing-context', need: 'prHeadSha' });
      return byPrHeadSha('reviewer', ctx.prHeadSha);
    case 'refiner':
      return byEventId('refiner', ctx.eventId);
  }
}

function requireCtx<T>(value: T | undefined, need: string, role: string, outcome: string): T {
  if (value === undefined || value === null || value === '') {
    throw new FerryError('state-invariant', {
      reason: 'output-contract',
      role,
      outcome,
      need,
    });
  }
  return value;
}

function devTransitionNote(g: ContractContext['gates']): string {
  if (g.shouldAutoTransition) return ' Moved to Review.';
  if (g.noAutoTransition) return ' FR18 auto-transition skipped (ferry:no-auto-transition).';
  return '';
}

function iterTransitionNote(g: ContractContext['gates']): string {
  if (g.shouldAutoTransition) return ' Moved back to Review.';
  if (g.noAutoTransition) return ' FR28 auto-transition skipped (ferry:no-auto-transition).';
  return '';
}

/**
 * Pure byte-exact reproduction of the script path's terminal audit comment,
 * labels, transition plan and exit code for the claude-code path.
 */
export function decideContract(output: AgentOutputV1, ctx: ContractContext): ContractDecision {
  const m = ctx.marker;
  const g = ctx.gates;

  switch (output.role) {
    // Accepted divergence (documented — #313 review): the script path appends a
    // ` [type override: {…}]` suffix (`overrideNote`) to the developer terminal
    // comment when a force/type override is in play (dev-action.ts:526-534).
    // The claude-code path has no force/type-override concept (the validated
    // agent artifact carries no override metadata, and threading it through
    // ContractContext would couple this pure decision to script-only state),
    // so the developer audit comment intentionally omits `overrideNote`. This
    // is an accepted, documented path divergence — markers, transitions and the
    // base comment string remain byte-identical; only the override annotation
    // (a human-readable note, not a Reconciler-relevant marker) differs. This
    // sits alongside the dry-run accepted divergence documented in the PR body.
    case 'developer': {
      if (output.outcome === 'blocked') {
        const reason = output.reason ?? 'no reason given';
        return {
          comment: `${m} 🚨 BLOCKED — ${reason}. Manual intervention required.`,
          labels: ['ferry:blocked'],
          transitions: [],
          exitCode: 1,
        };
      }
      const prUrl = requireCtx(ctx.prUrl ?? output.pr_url, 'pr_url', 'developer', output.outcome);
      const tn = devTransitionNote(g);
      const transitions: TransitionPlan[] = g.shouldAutoTransition
        ? [{ transitionIdEnv: 'FERRY_REVIEW_TRANSITION_ID', when: 'before-comment' }]
        : [];
      // NB: deliberately no `overrideNote` suffix here — see the accepted
      // divergence note above (dev-action.ts:526-534 appends one; cc-wrapper
      // has no override metadata, so it is intentionally omitted).
      const comment =
        output.outcome === 'already_satisfied'
          ? `${m} Spec already satisfied — verification PR: ${prUrl}.${tn}`
          : `${m} Implementation complete — PR: ${prUrl}.${tn}`;
      return { comment, labels: [], transitions, exitCode: 0 };
    }

    case 'iterator': {
      if (output.outcome === 'blocked') {
        const reason = output.reason ?? 'no reason given';
        return {
          comment: `${m} 🚨 BLOCKED — ${reason}. Manual intervention required.`,
          labels: ['ferry:blocked'],
          transitions: [],
          exitCode: 1,
        };
      }
      const prNumber = requireCtx(
        ctx.prNumber ?? output.pr_number,
        'pr_number',
        'iterator',
        output.outcome,
      );
      const tn = iterTransitionNote(g);
      const transitions: TransitionPlan[] = g.shouldAutoTransition
        ? [{ transitionIdEnv: 'FERRY_REVIEW_TRANSITION_ID', when: 'before-comment' }]
        : [];
      if (output.outcome === 'already_satisfied') {
        return {
          comment: `${m} Findings already addressed — no changes needed. Pushed to PR#${prNumber}.${tn}`,
          labels: [],
          transitions,
          exitCode: 0,
        };
      }
      const nextIteration = Math.max(0, ctx.priorIterations ?? 0) + 1;
      // Invariant: the script appends a dry-run-only ` (dry-run: branch push
      // suppressed)` `pushNote` here (iterate-action.ts:437). It is safely
      // omitted: `apply.ts` returns early under `ferry:dry-run` and suppresses
      // ALL external writes (apply.ts:75-83), so this comment is never posted
      // on the dry-run cc-wrapper path — `pushNote` can never surface.
      return {
        comment: `${m} Iteration ${nextIteration} complete. Pushed fixes to PR#${prNumber}.${tn}`,
        labels: [],
        transitions,
        exitCode: 0,
      };
    }

    case 'reviewer': {
      const prNumber = requireCtx(ctx.prNumber, 'prNumber', 'reviewer', output.verdict);
      if (output.verdict === 'approved') {
        const transitions: TransitionPlan[] = g.shouldTransitionApprove
          ? [{ transitionIdEnv: 'FERRY_APPROVE_TRANSITION_ID', when: 'after-comment' }]
          : [];
        return {
          comment: `${m} Approved. PR#${prNumber} is ready to merge.`,
          labels: [],
          transitions,
          prComment: output.review_comment,
          exitCode: 0,
        };
      }
      const cap = requireCtx(ctx.cap, 'cap', 'reviewer', output.verdict);
      const priorIterations = ctx.priorIterations ?? 0;
      const capReached = priorIterations >= cap;
      if (capReached) {
        return {
          comment: `${m} Changes requested (re-review). Iteration cap (${cap}) reached; see PR#${prNumber} and move ticket manually.`,
          labels: [],
          transitions: [],
          prComment: output.review_comment,
          exitCode: 0,
        };
      }
      const changesNote = g.shouldTransitionChanges ? ' Moved to Dev Iteration.' : '';
      const transitions: TransitionPlan[] = g.shouldTransitionChanges
        ? [{ transitionIdEnv: 'FERRY_ITER_TRANSITION_ID', when: 'after-comment' }]
        : [];
      return {
        comment: `${m} Changes requested (iteration ${priorIterations + 1}/${cap}).${changesNote} See PR#${prNumber} for details.`,
        labels: [],
        transitions,
        prComment: output.review_comment,
        exitCode: 0,
      };
    }

    // NB: the refiner role has no `decideContract` case — its claude-code
    // artifact is a `RefinerOutput` *plan*, applied by `applyRefinerCcArtifact`
    // (`dispatch/cc-apply-action.ts`), not a terminal outcome transcribed here.
  }
}
