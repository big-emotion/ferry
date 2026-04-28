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

  it('reports reason: empty for blank/whitespace input', () => {
    expect(classifyEmptyTicket('').reason).toBe('empty');
    expect(classifyEmptyTicket('   ').reason).toBe('empty');
  });

  it('reports reason: too-short for input below the word floor', () => {
    expect(classifyEmptyTicket('too short').reason).toBe('too-short');
    expect(classifyEmptyTicket('one two three four').reason).toBe('too-short');
  });

  it('reports reason: placeholder for n/a, tbd, todo, wip', () => {
    expect(classifyEmptyTicket('n/a').reason).toBe('placeholder');
    expect(classifyEmptyTicket('tbd').reason).toBe('placeholder');
    expect(classifyEmptyTicket('todo').reason).toBe('placeholder');
    expect(classifyEmptyTicket('WIP').reason).toBe('placeholder');
  });

  it('does not set a reason when the input is actionable', () => {
    expect(classifyEmptyTicket('Add a login button on the home page').reason).toBeUndefined();
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
