import { describe, it, expect } from 'vitest';
import { validateEnvelope } from '../envelope/validate.js';
import {
  PHASE_TO_WORKFLOW,
  phaseToWorkflow,
  phaseToDispatchType,
  shouldSkipForTaskType,
  buildTaskSkipComment,
} from './routing.js';

describe('PHASE_TO_WORKFLOW table', () => {
  it('maps every supported phase to its workflow filename and dispatch type', () => {
    expect(PHASE_TO_WORKFLOW).toEqual({
      refine: { workflow: 'ferry-refine.yml', dispatchType: 'ferry-refine' },
      dev: { workflow: 'ferry-dev.yml', dispatchType: 'ferry-dev' },
      review: { workflow: 'ferry-review.yml', dispatchType: 'ferry-review' },
      iterate: { workflow: 'ferry-iterate.yml', dispatchType: 'ferry-iterate' },
    });
  });

  it('is frozen so callers cannot mutate the source of truth', () => {
    expect(Object.isFrozen(PHASE_TO_WORKFLOW)).toBe(true);
  });
});

describe('phaseToWorkflow / phaseToDispatchType', () => {
  it.each([
    ['refine', 'ferry-refine.yml', 'ferry-refine'],
    ['dev', 'ferry-dev.yml', 'ferry-dev'],
    ['review', 'ferry-review.yml', 'ferry-review'],
    ['iterate', 'ferry-iterate.yml', 'ferry-iterate'],
  ] as const)('phase %s → %s / %s', (phase, workflow, dispatchType) => {
    expect(phaseToWorkflow(phase)).toBe(workflow);
    expect(phaseToDispatchType(phase)).toBe(dispatchType);
  });
});

describe('shouldSkipForTaskType (FR6 task-type filter)', () => {
  it('skips Task issue types', () => {
    expect(shouldSkipForTaskType('Task')).toEqual({
      skip: true,
      reason: 'ticket type Task is not processed by Ferry',
    });
  });

  it('is case-insensitive (normalized French "Tâche" maps to "Task" before this call)', () => {
    expect(shouldSkipForTaskType('task')).toEqual({
      skip: true,
      reason: 'ticket type Task is not processed by Ferry',
    });
    expect(shouldSkipForTaskType('TASK')).toEqual({
      skip: true,
      reason: 'ticket type Task is not processed by Ferry',
    });
  });

  it('does not skip Story / Bug / Spike issue types', () => {
    expect(shouldSkipForTaskType('Story')).toEqual({ skip: false });
    expect(shouldSkipForTaskType('Bug')).toEqual({ skip: false });
    expect(shouldSkipForTaskType('Spike')).toEqual({ skip: false });
  });

  it('does not skip a Task ticket when bypassTaskSkip is true (ferry:type:enable-task)', () => {
    expect(shouldSkipForTaskType('Task', { bypassTaskSkip: true })).toEqual({ skip: false });
    expect(shouldSkipForTaskType('task', { bypassTaskSkip: true })).toEqual({ skip: false });
  });

  it('still skips a Task ticket when bypassTaskSkip is false', () => {
    expect(shouldSkipForTaskType('Task', { bypassTaskSkip: false })).toEqual({
      skip: true,
      reason: 'ticket type Task is not processed by Ferry',
    });
  });

  it('does not skip a non-Task ticket regardless of bypassTaskSkip', () => {
    expect(shouldSkipForTaskType('Story', { bypassTaskSkip: false })).toEqual({ skip: false });
    expect(shouldSkipForTaskType('Bug', { bypassTaskSkip: true })).toEqual({ skip: false });
  });

  it('is backward compatible when overrides is not provided', () => {
    expect(shouldSkipForTaskType('Task')).toEqual({
      skip: true,
      reason: 'ticket type Task is not processed by Ferry',
    });
    expect(shouldSkipForTaskType('Story')).toEqual({ skip: false });
  });
});

describe('buildTaskSkipComment', () => {
  it('builds the documented skip comment in the required format', () => {
    expect(buildTaskSkipComment('refiner', '01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(
      '[ferry:refiner:01ARZ3NDEKTSV4RRFFQ69G5FAV] Skipped — ticket type Task is not processed by Ferry',
    );
  });

  it('uses the role as the agent prefix', () => {
    expect(buildTaskSkipComment('dev', 'r1')).toBe(
      '[ferry:dev:r1] Skipped — ticket type Task is not processed by Ferry',
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
