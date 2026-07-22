import { describe, expect, it } from 'vitest';
import { countPriorIterations } from './changes-guard.js';
import { reviewerLoopLimits } from './review-action.js';
import { DEFAULT_FERRY_CONFIG } from '../../lib/config.js';

describe('reviewer loop budget — reviewerLoopLimits', () => {
  it('bounds the reviewer per run with an input-token and EUR ceiling, not just iteration/output caps', () => {
    const limits = reviewerLoopLimits(DEFAULT_FERRY_CONFIG.limits);
    expect(limits.maxIterations).toBe(DEFAULT_FERRY_CONFIG.limits.reviewer_max_iterations);
    expect(limits.maxTokens).toBe(DEFAULT_FERRY_CONFIG.limits.reviewer_max_tokens);
    // Regression guard: the Opus-class reviewer must carry the same per-run
    // ceilings the developer and iterator do (previously it had neither).
    expect(limits.maxInputTokens).toBe(DEFAULT_FERRY_CONFIG.limits.max_tokens_per_run);
    expect(limits.maxCostEur).toBe(DEFAULT_FERRY_CONFIG.limits.max_cost_eur_per_run);
  });
});

const iteratorComment = (n: number) =>
  `[ferry:iterator:abc${n}] Iteration ${n} complete. Pushed fixes to PR#42. Moved back to Review.`;

const reviewerComment = (sha: string) =>
  `[ferry:reviewer:${sha}] Changes requested (iteration 1/3). Moved to Dev Iteration. See PR#42 for details.`;

describe('reviewer changes guard — countPriorIterations', () => {
  it('returns 0 when there are no comments at all', () => {
    expect(countPriorIterations([])).toBe(0);
  });

  it('returns 0 when only reviewer comments are present (no iterator cycle yet)', () => {
    expect(countPriorIterations([reviewerComment('aaa1111')])).toBe(0);
  });

  it('returns 1 after one completed iterator cycle', () => {
    const comments = [reviewerComment('aaa1111'), iteratorComment(1)];
    expect(countPriorIterations(comments)).toBe(1);
  });

  it('returns 2 after two completed iterator cycles', () => {
    const comments = [
      reviewerComment('aaa1111'),
      iteratorComment(1),
      reviewerComment('bbb2222'),
      iteratorComment(2),
    ];
    expect(countPriorIterations(comments)).toBe(2);
  });

  it('returns cap (3) after three completed iterator cycles', () => {
    const cap = 3;
    const comments = [
      reviewerComment('aaa1111'),
      iteratorComment(1),
      reviewerComment('bbb2222'),
      iteratorComment(2),
      reviewerComment('ccc3333'),
      iteratorComment(3),
    ];
    expect(countPriorIterations(comments)).toBe(cap);
  });

  it('does not count iterator comments that lack the completion phrase', () => {
    const incompleteMarker = '[ferry:iterator:abc1] No open PR found for branch ferry/PROJ-1.';
    expect(countPriorIterations([incompleteMarker])).toBe(0);
  });

  it('capReached is false for 0, 1, 2 prior iterations (below default cap of 3)', () => {
    const cap = 3;
    for (const n of [0, 1, 2]) {
      const comments = Array.from({ length: n }, (_, i) => iteratorComment(i + 1));
      const priorIterations = countPriorIterations(comments);
      expect(priorIterations < cap).toBe(true);
    }
  });

  it('capReached is true at cap (3) prior iterations', () => {
    const cap = 3;
    const comments = Array.from({ length: cap }, (_, i) => iteratorComment(i + 1));
    const priorIterations = countPriorIterations(comments);
    expect(priorIterations >= cap).toBe(true);
  });
});
