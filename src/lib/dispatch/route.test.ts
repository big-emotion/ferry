import { describe, expect, it } from 'vitest';
import { validateEnvelope } from '../envelope/validate.js';
import { buildTaskSkipComment, phaseToWorkflow, shouldSkipForTaskType } from './route.js';

describe('dispatch routing helpers', () => {
  it('maps phases to workflow filenames', () => {
    expect(phaseToWorkflow('refine')).toBe('refine.yml');
    expect(phaseToWorkflow('dev')).toBe('dev.yml');
    expect(phaseToWorkflow('review')).toBe('review.yml');
    expect(phaseToWorkflow('iterate')).toBe('iterate.yml');
  });

  it('throws for unknown phases', () => {
    // validateEnvelope enforces allowed phases, but route should still be defensive.
    expect(() => phaseToWorkflow('nope' as never)).toThrow(/Unknown phase/);
  });

  it('skips Task issue types', () => {
    expect(shouldSkipForTaskType('Task')).toEqual({
      skip: true,
      reason: 'ticket type Task is not processed by Ferry',
    });
  });

  it('does not skip Story issue types', () => {
    expect(shouldSkipForTaskType('Story')).toEqual({ skip: false });
  });

  it('builds the Task skip comment in the required format', () => {
    expect(buildTaskSkipComment('refiner', '01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(
      '[ferry:refiner:01ARZ3NDEKTSV4RRFFQ69G5FAV] Skipped — ticket type Task is not processed by Ferry',
    );
  });

  it('accepts envelope with issue_type', () => {
    const env = validateEnvelope({
      version: 'v1',
      event_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      ticket_key: 'CHAN-27',
      phase: 'refine',
      source: 'jira-column',
      ts: '2026-01-01T00:00:00Z',
      issue_type: 'Task',
    });
    expect(env.issue_type).toBe('Task');
  });
});
