import { describe, it, expect } from 'vitest';
import {
  decideContract,
  markerRoleToken,
  resolveContractMarker,
  type ContractContext,
} from './contract.js';
import { FerryError } from '../errors/index.js';
import type {
  DeveloperAgentOutput,
  IteratorAgentOutput,
  ReviewerAgentOutput,
} from './agent-output.js';

const SHA = 'abc1234def5678';
const SHA7 = 'abc1234';

describe('markerRoleToken', () => {
  it('maps developer to dev, others to role (script parity)', () => {
    expect(markerRoleToken('developer')).toBe('dev');
    expect(markerRoleToken('iterator')).toBe('iterator');
    expect(markerRoleToken('reviewer')).toBe('reviewer');
    expect(markerRoleToken('refiner')).toBe('refiner');
  });
});

describe('resolveContractMarker — byte-identical to script keying', () => {
  it('developer keys on branch head SHA (7) with dev token', () => {
    expect(resolveContractMarker('developer', { eventId: 'E1', branchHeadSha: SHA })).toBe(
      `[ferry:dev:${SHA7}]`,
    );
  });
  it('developer falls back to event id when no branch head SHA', () => {
    expect(resolveContractMarker('developer', { eventId: 'E1' })).toBe('[ferry:dev:E1]');
  });
  it('iterator keys on PR head SHA (7)', () => {
    expect(resolveContractMarker('iterator', { eventId: 'E1', prHeadSha: SHA })).toBe(
      `[ferry:iterator:${SHA7}]`,
    );
  });
  it('reviewer keys on PR head SHA (7)', () => {
    expect(resolveContractMarker('reviewer', { eventId: 'E1', prHeadSha: SHA })).toBe(
      `[ferry:reviewer:${SHA7}]`,
    );
  });
  it('refiner keys on event id', () => {
    expect(resolveContractMarker('refiner', { eventId: 'EVT-9' })).toBe('[ferry:refiner:EVT-9]');
  });
  it('throws fail-closed when iterator/reviewer marker lacks a PR head SHA', () => {
    expect(() => resolveContractMarker('iterator', { eventId: 'E1' })).toThrow(FerryError);
    expect(() => resolveContractMarker('reviewer', { eventId: 'E1' })).toThrow(FerryError);
  });
});

const baseCtx = (over: Partial<ContractContext> = {}): ContractContext => ({
  marker: '[ferry:dev:abc1234]',
  gates: {},
  ...over,
});

describe('decideContract — developer (FR18)', () => {
  const dev = (o: Partial<DeveloperAgentOutput>): DeveloperAgentOutput => ({
    version: 'v1',
    role: 'developer',
    outcome: 'implemented',
    summary: 's',
    ...o,
  });

  it('implemented + auto-transition → "Implementation complete" + Moved to Review + FR18 before-comment', () => {
    const d = decideContract(
      dev({ outcome: 'implemented' }),
      baseCtx({ prUrl: 'https://x/pr/7', gates: { shouldAutoTransition: true } }),
    );
    expect(d.comment).toBe(
      '[ferry:dev:abc1234] Implementation complete — PR: https://x/pr/7. Moved to Review.',
    );
    expect(d.transitions).toEqual([
      { transitionIdEnv: 'FERRY_REVIEW_TRANSITION_ID', when: 'before-comment' },
    ]);
    expect(d.exitCode).toBe(0);
    expect(d.labels).toEqual([]);
  });

  it('implemented + no-auto-transition label → skipped note, no transition', () => {
    const d = decideContract(
      dev({}),
      baseCtx({ prUrl: 'https://x/pr/7', gates: { noAutoTransition: true } }),
    );
    expect(d.comment).toBe(
      '[ferry:dev:abc1234] Implementation complete — PR: https://x/pr/7. FR18 auto-transition skipped (ferry:no-auto-transition).',
    );
    expect(d.transitions).toEqual([]);
  });

  it('implemented + no gate → bare comment, no note', () => {
    const d = decideContract(dev({}), baseCtx({ prUrl: 'https://x/pr/7' }));
    expect(d.comment).toBe('[ferry:dev:abc1234] Implementation complete — PR: https://x/pr/7.');
  });

  it('already_satisfied → verification-PR wording', () => {
    const d = decideContract(
      dev({ outcome: 'already_satisfied' }),
      baseCtx({ prUrl: 'https://x/pr/7', gates: { shouldAutoTransition: true } }),
    );
    expect(d.comment).toBe(
      '[ferry:dev:abc1234] Spec already satisfied — verification PR: https://x/pr/7. Moved to Review.',
    );
  });

  it('blocked → BLOCKED comment + ferry:blocked label + exit 1, no transition', () => {
    const d = decideContract(
      dev({ outcome: 'blocked', reason: 'missing creds' }),
      baseCtx({ gates: { shouldAutoTransition: true } }),
    );
    expect(d.comment).toBe(
      '[ferry:dev:abc1234] 🚨 BLOCKED — missing creds. Manual intervention required.',
    );
    expect(d.labels).toEqual(['ferry:blocked']);
    expect(d.transitions).toEqual([]);
    expect(d.exitCode).toBe(1);
  });

  it('blocked without reason → "no reason given" (script parity)', () => {
    const d = decideContract(dev({ outcome: 'blocked' }), baseCtx());
    expect(d.comment).toBe(
      '[ferry:dev:abc1234] 🚨 BLOCKED — no reason given. Manual intervention required.',
    );
  });

  it('fail-closed: implemented without a PR url throws (assertDevOutputContract parity)', () => {
    expect(() => decideContract(dev({ outcome: 'implemented' }), baseCtx())).toThrow(FerryError);
  });

  it('uses pr_url from the artifact when ctx.prUrl is absent', () => {
    const d = decideContract(dev({ pr_url: 'https://art/pr/9' }), baseCtx());
    expect(d.comment).toBe('[ferry:dev:abc1234] Implementation complete — PR: https://art/pr/9.');
  });
});

describe('decideContract — iterator (FR28)', () => {
  const M = '[ferry:iterator:abc1234]';
  const iter = (o: Partial<IteratorAgentOutput>): IteratorAgentOutput => ({
    version: 'v1',
    role: 'iterator',
    outcome: 'implemented',
    summary: 's',
    pr_number: 7,
    ...o,
  });

  it('implemented → "Iteration N complete" with priorIterations+1 + Moved back to Review', () => {
    const d = decideContract(
      iter({}),
      baseCtx({ marker: M, priorIterations: 2, gates: { shouldAutoTransition: true } }),
    );
    expect(d.comment).toBe(
      `${M} Iteration 3 complete. Pushed fixes to PR#7. Moved back to Review.`,
    );
    expect(d.transitions).toEqual([
      { transitionIdEnv: 'FERRY_REVIEW_TRANSITION_ID', when: 'before-comment' },
    ]);
  });

  it('implemented, no prior iterations → Iteration 1', () => {
    const d = decideContract(iter({}), baseCtx({ marker: M }));
    expect(d.comment).toBe(`${M} Iteration 1 complete. Pushed fixes to PR#7.`);
    expect(d.transitions).toEqual([]);
  });

  it('already_satisfied → findings-addressed wording', () => {
    const d = decideContract(
      iter({ outcome: 'already_satisfied' }),
      baseCtx({ marker: M, gates: { noAutoTransition: true } }),
    );
    expect(d.comment).toBe(
      `${M} Findings already addressed — no changes needed. Pushed to PR#7. FR28 auto-transition skipped (ferry:no-auto-transition).`,
    );
  });

  it('blocked → BLOCKED + ferry:blocked + exit 1', () => {
    const d = decideContract(
      iter({ outcome: 'blocked', reason: 'conflict' }),
      baseCtx({ marker: M }),
    );
    expect(d.comment).toBe(`${M} 🚨 BLOCKED — conflict. Manual intervention required.`);
    expect(d.labels).toEqual(['ferry:blocked']);
    expect(d.exitCode).toBe(1);
  });

  it('fail-closed: implemented without a PR number throws', () => {
    expect(() =>
      decideContract(
        { version: 'v1', role: 'iterator', outcome: 'implemented', summary: 's' },
        baseCtx({ marker: M }),
      ),
    ).toThrow(FerryError);
  });
});

describe('decideContract — reviewer (FR24)', () => {
  const M = '[ferry:reviewer:abc1234]';
  const rev = (o: Partial<ReviewerAgentOutput>): ReviewerAgentOutput => ({
    version: 'v1',
    role: 'reviewer',
    verdict: 'approved',
    review_comment: 'LGTM',
    summary: 's',
    ...o,
  });

  it('approved → ready-to-merge comment + FR24 approve after-comment + prComment passthrough', () => {
    const d = decideContract(
      rev({ verdict: 'approved' }),
      baseCtx({ marker: M, prNumber: 7, gates: { shouldTransitionApprove: true } }),
    );
    expect(d.comment).toBe(`${M} Approved. PR#7 is ready to merge.`);
    expect(d.transitions).toEqual([
      { transitionIdEnv: 'FERRY_APPROVE_TRANSITION_ID', when: 'after-comment' },
    ]);
    expect(d.prComment).toBe('LGTM');
  });

  it('approved, transition gated off → no transition', () => {
    const d = decideContract(rev({}), baseCtx({ marker: M, prNumber: 7 }));
    expect(d.transitions).toEqual([]);
  });

  it('changes_requested under cap → iteration X/cap + Moved to Dev Iteration + FR24 changes', () => {
    const d = decideContract(
      rev({ verdict: 'changes_requested', review_comment: 'fix it' }),
      baseCtx({
        marker: M,
        prNumber: 7,
        priorIterations: 1,
        cap: 5,
        gates: { shouldTransitionChanges: true },
      }),
    );
    expect(d.comment).toBe(
      `${M} Changes requested (iteration 2/5). Moved to Dev Iteration. See PR#7 for details.`,
    );
    expect(d.transitions).toEqual([
      { transitionIdEnv: 'FERRY_ITER_TRANSITION_ID', when: 'after-comment' },
    ]);
    expect(d.prComment).toBe('fix it');
  });

  it('changes_requested under cap, gate off → no "Moved" note, no transition', () => {
    const d = decideContract(
      rev({ verdict: 'changes_requested' }),
      baseCtx({ marker: M, prNumber: 7, priorIterations: 0, cap: 3 }),
    );
    expect(d.comment).toBe(`${M} Changes requested (iteration 1/3). See PR#7 for details.`);
    expect(d.transitions).toEqual([]);
  });

  it('changes_requested at cap → re-review/manual-move wording, no transition', () => {
    const d = decideContract(
      rev({ verdict: 'changes_requested' }),
      baseCtx({
        marker: M,
        prNumber: 7,
        priorIterations: 5,
        cap: 5,
        gates: { shouldTransitionChanges: true },
      }),
    );
    expect(d.comment).toBe(
      `${M} Changes requested (re-review). Iteration cap (5) reached; see PR#7 and move ticket manually.`,
    );
    expect(d.transitions).toEqual([]);
  });

  it('fail-closed: reviewer without a PR number throws', () => {
    expect(() => decideContract(rev({}), baseCtx({ marker: M }))).toThrow(FerryError);
  });
});
