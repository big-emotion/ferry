import { describe, expect, it } from 'vitest';
import {
  buildEscalationBlock,
  writeEscalationToBody,
  clearEscalationFromBody,
  EscalationError,
} from './escalation.js';

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

  it('rejects fewer than 2 or more than 5 tried bullets', () => {
    expect(() => buildEscalationBlock({ ...validInput, what_i_tried: ['only one'] })).toThrow(
      EscalationError,
    );
    expect(() =>
      buildEscalationBlock({
        ...validInput,
        what_i_tried: ['a', 'b', 'c', 'd', 'e', 'f'],
      }),
    ).toThrow(EscalationError);
  });

  it('rejects bullets longer than 120 characters', () => {
    const long = 'x'.repeat(121);
    expect(() => buildEscalationBlock({ ...validInput, what_i_tried: [long, 'ok'] })).toThrow(
      EscalationError,
    );
  });

  it('requires at least one fingerprinted finding', () => {
    expect(() => buildEscalationBlock({ ...validInput, what_blocked_me: [] })).toThrow(
      EscalationError,
    );
  });

  it('caps hypothesis at 400 characters', () => {
    expect(() =>
      buildEscalationBlock({
        ...validInput,
        hypothesis: 'p'.repeat(401),
      }),
    ).toThrow(EscalationError);
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
