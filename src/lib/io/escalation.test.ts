import { describe, expect, it } from 'vitest';
import {
  buildEscalationBlock,
  writeEscalationToBody,
  clearEscalationFromBody,
} from './escalation.js';
import { FerryError } from '../error.js';

const validInput = {
  what_i_tried: ['ran reviewer twice', 'tried iterator once'],
  what_blocked_me: [
    {
      rule_id: 'no-skipped-tests',
      message: 'test still skipped at src/foo.test.ts:3',
      file: 'src/foo.test.ts',
      line_start: 3,
      line_end: 3,
    },
  ],
  hypothesis:
    'I might be missing the test fixture. Possibly the missing artifact is examples/foo-fixture.json.',
  next_action: 'Run npm run review:rubric and review the rule taxonomy',
};

describe('escalation block', () => {
  it('renders all five required sections inside ferry:escalation markers', () => {
    const block = buildEscalationBlock(validInput);
    expect(block).toContain('<!-- ferry:escalation -->');
    expect(block).toContain('<!-- /ferry:escalation -->');
    expect(block).toContain('🚨 Escalation Summary');
    expect(block).toContain('What I tried');
    expect(block).toContain('What blocked me');
    expect(block).toContain('My best hypothesis');
    expect(block).toContain('Suggested next action');
    expect(block).toContain('no-skipped-tests');
  });

  it('rejects fewer than 2 or more than 5 tried bullets with FerryError(state-invariant)', () => {
    const tooFew = (): unknown => {
      try {
        buildEscalationBlock({ ...validInput, what_i_tried: ['only one'] });
        return null;
      } catch (e) {
        return e;
      }
    };
    const e1 = tooFew();
    expect(e1).toBeInstanceOf(FerryError);
    expect((e1 as FerryError).code).toBe('state-invariant');
    expect((e1 as FerryError).context).toMatchObject({ reason: 'escalation-tried-bullet-count' });

    expect(() =>
      buildEscalationBlock({ ...validInput, what_i_tried: ['a', 'b', 'c', 'd', 'e', 'f'] }),
    ).toThrow(FerryError);
  });

  it('rejects bullets longer than 120 characters with FerryError(state-invariant)', () => {
    const long = 'x'.repeat(121);
    let caught: unknown;
    try {
      buildEscalationBlock({ ...validInput, what_i_tried: [long, 'ok'] });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FerryError);
    expect((caught as FerryError).context).toMatchObject({
      reason: 'escalation-tried-bullet-length',
    });
  });

  it('requires at least one fingerprinted finding with FerryError(state-invariant)', () => {
    let caught: unknown;
    try {
      buildEscalationBlock({ ...validInput, what_blocked_me: [] });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FerryError);
    expect((caught as FerryError).context).toMatchObject({ reason: 'escalation-blocked-empty' });
  });

  it('caps hypothesis at 400 characters with FerryError(state-invariant)', () => {
    let caught: unknown;
    try {
      buildEscalationBlock({ ...validInput, hypothesis: 'p'.repeat(401) });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FerryError);
    expect((caught as FerryError).context).toMatchObject({
      reason: 'escalation-hypothesis-length',
    });
  });

  it('rejects empty hypothesis with FerryError(state-invariant)', () => {
    let caught: unknown;
    try {
      buildEscalationBlock({ ...validInput, hypothesis: '' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FerryError);
    expect((caught as FerryError).context).toMatchObject({
      reason: 'escalation-hypothesis-length',
    });
  });

  it('rejects empty next_action with FerryError(state-invariant)', () => {
    let caught: unknown;
    try {
      buildEscalationBlock({ ...validInput, next_action: '' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FerryError);
    expect((caught as FerryError).context).toMatchObject({
      reason: 'escalation-next-action-empty',
    });
  });

  it('renders the optional Context section when provided', () => {
    const block = buildEscalationBlock({
      ...validInput,
      context: 'Last 3 reviewer runs all flagged the same finding fingerprint.',
    });
    expect(block).toContain('**Context**');
    expect(block).toContain('Last 3 reviewer runs');
  });

  it('omits the Context section when context is empty or whitespace', () => {
    const block1 = buildEscalationBlock({ ...validInput, context: '' });
    const block2 = buildEscalationBlock({ ...validInput, context: '   \n\t  ' });
    expect(block1).not.toContain('**Context**');
    expect(block2).not.toContain('**Context**');
  });

  it('writeEscalationToBody is idempotent across re-runs', () => {
    const body1 = writeEscalationToBody('Hello.', validInput);
    const body2 = writeEscalationToBody(body1, validInput);
    const occurrences = body2.match(/<!-- ferry:escalation -->/g) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it('clearEscalationFromBody removes the marker region', () => {
    const body1 = writeEscalationToBody('Hello.', validInput);
    const body2 = clearEscalationFromBody(body1);
    expect(body2).not.toContain('<!-- ferry:escalation -->');
  });
});
