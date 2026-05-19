import { describe, it, expect } from 'vitest';
import { validateAgentOutput } from './agent-output.js';
import { FerryError } from '../errors/index.js';

const DEV_OK = {
  version: 'v1',
  role: 'developer',
  outcome: 'implemented',
  summary: 'Implemented the feature',
  pr_url: 'https://github.com/o/r/pull/7',
};

const REVIEWER_OK = {
  version: 'v1',
  role: 'reviewer',
  verdict: 'approved',
  review_comment: '**Verdict**: Approved\n\nLooks good.',
  summary: 'Ready to merge',
};

const ITERATOR_OK = {
  version: 'v1',
  role: 'iterator',
  outcome: 'implemented',
  summary: 'Addressed findings',
  pr_number: 7,
};

const REFINER_OK = {
  version: 'v1',
  role: 'refiner',
  result: 'refined',
  summary: 'Reconciled sub-tasks',
  created: 2,
  kept: 1,
  staled: 0,
};

describe('validateAgentOutput — happy paths', () => {
  it('accepts a developer artifact', () => {
    expect(validateAgentOutput(DEV_OK)).toEqual(DEV_OK);
  });

  it('accepts a reviewer artifact', () => {
    expect(validateAgentOutput(REVIEWER_OK)).toEqual(REVIEWER_OK);
  });

  it('accepts an iterator artifact', () => {
    expect(validateAgentOutput(ITERATOR_OK)).toEqual(ITERATOR_OK);
  });

  it('accepts a refiner refined artifact', () => {
    expect(validateAgentOutput(REFINER_OK)).toEqual(REFINER_OK);
  });

  it('accepts a refiner noop artifact', () => {
    const noop = { version: 'v1', role: 'refiner', result: 'noop', summary: 's', noop_reason: 'r' };
    expect(validateAgentOutput(noop)).toEqual(noop);
  });

  it('accepts a JSON string artifact (as written to a file by the action)', () => {
    expect(validateAgentOutput(JSON.stringify(DEV_OK))).toEqual(DEV_OK);
  });

  it('accepts a blocked developer artifact with a reason', () => {
    const blocked = {
      version: 'v1',
      role: 'developer',
      outcome: 'blocked',
      summary: 's',
      reason: 'missing API key',
    };
    expect(validateAgentOutput(blocked)).toEqual(blocked);
  });
});

describe('validateAgentOutput — fail-closed', () => {
  it('throws FerryError state-invariant for non-JSON string', () => {
    expect(() => validateAgentOutput('{ not json')).toThrow(FerryError);
  });

  it('throws for a missing role', () => {
    expect(() => validateAgentOutput({ version: 'v1', summary: 's' })).toThrow(FerryError);
  });

  it('throws for an unknown role', () => {
    expect(() => validateAgentOutput({ version: 'v1', role: 'planner', summary: 's' })).toThrow(
      FerryError,
    );
  });

  it('throws for a wrong version', () => {
    expect(() => validateAgentOutput({ ...DEV_OK, version: 'v2' })).toThrow(FerryError);
  });

  it('throws for an invalid developer outcome', () => {
    expect(() => validateAgentOutput({ ...DEV_OK, outcome: 'maybe' })).toThrow(FerryError);
  });

  it('throws for an invalid reviewer verdict', () => {
    expect(() => validateAgentOutput({ ...REVIEWER_OK, verdict: 'lgtm' })).toThrow(FerryError);
  });

  it('throws for additional properties (strict contract)', () => {
    expect(() => validateAgentOutput({ ...DEV_OK, injected: 'x' })).toThrow(FerryError);
  });

  it('throws for a reviewer artifact missing review_comment', () => {
    expect(() =>
      validateAgentOutput({ version: 'v1', role: 'reviewer', verdict: 'approved', summary: 's' }),
    ).toThrow(FerryError);
  });

  it('throws for an empty summary', () => {
    expect(() => validateAgentOutput({ ...DEV_OK, summary: '' })).toThrow(FerryError);
  });

  it('does NOT leak raw field values in the error (NFR-S1)', () => {
    try {
      validateAgentOutput({ ...DEV_OK, summary: 'SECRET-LEAK-TOKEN', outcome: 'nope' });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(FerryError);
      const msg = (err as FerryError).message;
      expect(msg).not.toContain('SECRET-LEAK-TOKEN');
    }
  });
});
