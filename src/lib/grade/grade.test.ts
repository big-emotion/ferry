import { describe, expect, it } from 'vitest';
import { computeReviewerVerdict, type RubricScores } from './index.js';

describe('computeReviewerVerdict', () => {
  describe('threshold mapping (no Correct=0 override)', () => {
    it.each<[RubricScores, 'actionable' | 'weak' | 'rubber_stamp']>([
      // total = 8 → actionable
      [{ substantive: 2, specific: 2, correct: 2, actionable: 2 }, 'actionable'],
      // total = 5 → actionable (lower bound)
      [{ substantive: 1, specific: 1, correct: 2, actionable: 1 }, 'actionable'],
      // total = 4 → weak (upper bound)
      [{ substantive: 1, specific: 1, correct: 1, actionable: 1 }, 'weak'],
      // total = 3 → weak (lower bound)
      [{ substantive: 1, specific: 1, correct: 1, actionable: 0 }, 'weak'],
      // total = 2 → rubber_stamp (upper bound)
      [{ substantive: 1, specific: 1, correct: 0, actionable: 0 }, 'rubber_stamp'],
      // total = 0 → rubber_stamp (lower bound)
      [{ substantive: 0, specific: 0, correct: 0, actionable: 0 }, 'rubber_stamp'],
    ])('scores %j → %s', (scores, expected) => {
      expect(computeReviewerVerdict(scores)).toBe(expected);
    });
  });

  describe('Correct=0 override', () => {
    it('downgrades actionable to weak when correct=0 (total=6 with correct=0)', () => {
      // 2+2+0+2 = 6, would be actionable, but Correct=0 caps at weak
      expect(
        computeReviewerVerdict({ substantive: 2, specific: 2, correct: 0, actionable: 2 }),
      ).toBe('weak');
    });

    it('keeps weak as weak when correct=0 (total=3)', () => {
      // 1+1+0+1 = 3, weak — unchanged
      expect(
        computeReviewerVerdict({ substantive: 1, specific: 1, correct: 0, actionable: 1 }),
      ).toBe('weak');
    });

    it('does NOT upgrade rubber_stamp to weak when correct=0 (total=2)', () => {
      // 1+1+0+0 = 2, rubber_stamp — cap is "no higher than weak", not "minimum weak"
      expect(
        computeReviewerVerdict({ substantive: 1, specific: 1, correct: 0, actionable: 0 }),
      ).toBe('rubber_stamp');
    });
  });

  describe('input validation', () => {
    it.each([-1, 3, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects non-integer-0-2 score %s',
      (bad) => {
        expect(() =>
          computeReviewerVerdict({ substantive: bad, specific: 0, correct: 0, actionable: 0 }),
        ).toThrow();
      },
    );
  });
});
