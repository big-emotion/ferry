import { describe, it, expect } from 'vitest';
import {
  PHASE_TO_WORKFLOW,
  phaseToWorkflow,
  phaseToDispatchType,
  shouldProcessTicketType,
  skipCommentForTaskType,
  type TicketType,
} from './routing.js';
import { FerryError } from '../error.js';

describe('PHASE_TO_WORKFLOW table', () => {
  it('maps every supported phase to its workflow filename and dispatch type', () => {
    expect(PHASE_TO_WORKFLOW).toEqual({
      refine: { workflow: 'refine.yml', dispatchType: 'ferry-refine' },
      dev: { workflow: 'dev.yml', dispatchType: 'ferry-dev' },
      review: { workflow: 'review.yml', dispatchType: 'ferry-review' },
      iterate: { workflow: 'iterate.yml', dispatchType: 'ferry-iterate' },
    });
  });

  it('is frozen so callers cannot mutate the source of truth', () => {
    expect(Object.isFrozen(PHASE_TO_WORKFLOW)).toBe(true);
  });
});

describe('phaseToWorkflow / phaseToDispatchType', () => {
  it.each([
    ['refine', 'refine.yml', 'ferry-refine'],
    ['dev', 'dev.yml', 'ferry-dev'],
    ['review', 'review.yml', 'ferry-review'],
    ['iterate', 'iterate.yml', 'ferry-iterate'],
  ] as const)('phase %s → %s / %s', (phase, workflow, dispatchType) => {
    expect(phaseToWorkflow(phase)).toBe(workflow);
    expect(phaseToDispatchType(phase)).toBe(dispatchType);
  });

  it('throws FerryError(state-invariant, unknown-phase) for unsupported phase (defensive runtime guard)', () => {
    let caught: unknown;
    try {
      // Cast through unknown — TypeScript would normally block this, but we want the runtime guard exercised
      // for callers that bypass type-checking (dynamic strings, deserialised data, etc.).
      phaseToWorkflow('deploy' as unknown as 'refine');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FerryError);
    expect((caught as FerryError).code).toBe('state-invariant');
    expect((caught as FerryError).context).toMatchObject({
      reason: 'unknown-phase',
      phase: 'deploy',
    });
  });

  it('phaseToDispatchType also throws FerryError(state-invariant) for unknown phase', () => {
    expect(() => phaseToDispatchType('nope' as unknown as 'refine')).toThrowError(FerryError);
  });
});

describe('shouldProcessTicketType (FR6 task-type filter)', () => {
  it.each([
    ['Story', true],
    ['Bug', true],
    ['Spike', true],
  ] as const)('processes %s tickets', (type, expected) => {
    expect(shouldProcessTicketType(type as TicketType)).toBe(expected);
  });

  it('skips Task tickets', () => {
    expect(shouldProcessTicketType('Task')).toBe(false);
  });

  it('skips when ticket_type is undefined (defensive — Jira may omit field)', () => {
    expect(shouldProcessTicketType(undefined)).toBe(true);
  });
});

describe('skipCommentForTaskType', () => {
  it('returns the documented skip comment for FR6', () => {
    const comment = skipCommentForTaskType({
      runId: '01HXXX',
      ticketType: 'Task',
      phase: 'refine',
    });
    expect(comment).toBe(
      '[ferry:refiner:01HXXX] Skipped — ticket type Task is not processed by Ferry',
    );
  });

  it('uses the phase as the agent prefix', () => {
    expect(skipCommentForTaskType({ runId: 'r1', ticketType: 'Task', phase: 'dev' })).toBe(
      '[ferry:dev:r1] Skipped — ticket type Task is not processed by Ferry',
    );
  });
});
