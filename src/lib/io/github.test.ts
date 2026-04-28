import { describe, it, expect } from 'vitest';
import { updatePrBody, writeEscalationToPrBody, clearEscalationFromPrBody } from './github.js';
import type { EscalationInput } from './escalation.js';

const VALID_ESCALATION: EscalationInput = {
  what_i_tried: ['attempt one', 'attempt two'],
  what_blocked_me: [
    {
      rule_id: 'eslint/no-unused-vars',
      message: 'unused variable foo',
      file: 'src/x.ts',
      line_start: 10,
      line_end: 10,
    },
  ],
  hypothesis: 'a missing import',
  next_action: 'add the import',
};

describe('updatePrBody', () => {
  it('returns the supplied body via the scaffold path', async () => {
    const result = await updatePrBody({
      repo: 'big-emotion/ferry',
      prNumber: 42,
      body: 'hello',
    });
    expect(result.body).toBe('hello');
  });
});

describe('writeEscalationToPrBody', () => {
  it('inserts the escalation block into the persisted body', async () => {
    const result = await writeEscalationToPrBody({
      repo: 'big-emotion/ferry',
      prNumber: 42,
      currentBody: 'pre-existing description',
      escalation: VALID_ESCALATION,
    });
    expect(result.body).toContain('<!-- ferry:escalation -->');
    expect(result.body).toContain('Escalation Summary');
    expect(result.body).toContain('pre-existing description');
  });

  it('is idempotent across re-runs', async () => {
    const first = await writeEscalationToPrBody({
      repo: 'big-emotion/ferry',
      prNumber: 42,
      currentBody: 'desc',
      escalation: VALID_ESCALATION,
    });
    const second = await writeEscalationToPrBody({
      repo: 'big-emotion/ferry',
      prNumber: 42,
      currentBody: first.body,
      escalation: VALID_ESCALATION,
    });
    expect(second.body).toBe(first.body);
  });
});

describe('clearEscalationFromPrBody', () => {
  it('removes the escalation block from the persisted body', async () => {
    const written = await writeEscalationToPrBody({
      repo: 'big-emotion/ferry',
      prNumber: 42,
      currentBody: 'desc',
      escalation: VALID_ESCALATION,
    });
    const cleared = await clearEscalationFromPrBody({
      repo: 'big-emotion/ferry',
      prNumber: 42,
      currentBody: written.body,
    });
    expect(cleared.body).not.toContain('<!-- ferry:escalation -->');
    expect(cleared.body).toContain('desc');
  });

  it('is a no-op when body has no marker region', async () => {
    const cleared = await clearEscalationFromPrBody({
      repo: 'big-emotion/ferry',
      prNumber: 42,
      currentBody: 'no markers here',
    });
    expect(cleared.body).toBe('no markers here');
  });
});
