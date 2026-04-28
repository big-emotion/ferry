import { describe, it, expect } from 'vitest';
import {
  classifyEmptyTicket,
  formatEmptyTicketComment,
  formatRefinerReadyComment,
} from './empty.js';

describe('classifyEmptyTicket (Story 3-3 FR11)', () => {
  it.each([[''], ['   '], ['too short'], ['n/a'], ['tbd'], ['todo']])(
    'classifies "%s" as unactionable',
    (text) => {
      expect(classifyEmptyTicket(text).unactionable).toBe(true);
    },
  );

  it.each([
    ['Add a login button on the home page so users can authenticate'],
    ['Investigate why the deploy script fails on Mondays — see attached log'],
  ])('classifies "%s" as actionable', (text) => {
    expect(classifyEmptyTicket(text).unactionable).toBe(false);
  });
});

describe('formatEmptyTicketComment (Story 3-3 FR11)', () => {
  it('returns the documented comment string', () => {
    expect(formatEmptyTicketComment({ runId: 'r1' })).toBe(
      '[ferry:refiner:r1] Cannot plan — ticket description is empty or unactionable. Please add requirements and re-trigger.',
    );
  });
});

describe('formatRefinerReadyComment (Story 3-3)', () => {
  it('mentions the marker and sub-task count', () => {
    const text = formatRefinerReadyComment({ runId: 'r1', subtaskCount: 4 });
    expect(text).toContain('[ferry:refiner:r1]');
    expect(text).toContain('4 sub-tasks created');
  });
});
