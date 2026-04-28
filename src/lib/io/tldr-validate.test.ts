import { describe, expect, it } from 'vitest';
import { upsertTldrInBody } from './tldr.js';
import { validateTldrBlock } from './tldr-validate.js';

const baseInput = {
  ships: 'ship summary',
  touches_files: 1,
  touches_lines: 5,
  risk_level: 'low' as const,
  risk_justification: 'small change',
  tests: '1 test',
  rollback: 'git revert',
  reviewer_verdict: 'pending',
};

const FERRY_BOT = 'ferry-bot';

describe('validateTldrBlock', () => {
  it('passes for a well-formed block', () => {
    const body = upsertTldrInBody('', baseInput);
    const r = validateTldrBlock(body, FERRY_BOT, FERRY_BOT);
    expect(r.ok).toBe(true);
  });

  it('fails when ferry:tldr marker is missing', () => {
    const r = validateTldrBlock('no tldr here', FERRY_BOT, FERRY_BOT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/missing/i);
  });

  it('fails when fields are out of order', () => {
    const reordered = `<!-- ferry:tldr -->
| Field | Value |
|---|---|
| Touches | 4 files / +132 |
| Ships | x |
| Risk | low |
| Tests | y |
| Rollback | z |
| Reviewer verdict | pending |
<!-- /ferry:tldr -->`;
    const r = validateTldrBlock(reordered, FERRY_BOT, FERRY_BOT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/out of order/i);
  });

  it('fails when block exceeds 500 chars', () => {
    const huge = `<!-- ferry:tldr -->\n${'a'.repeat(600)}\n<!-- /ferry:tldr -->`;
    const r = validateTldrBlock(huge, FERRY_BOT, FERRY_BOT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/too long/i);
  });

  it('skips validation for human-authored PRs', () => {
    const r = validateTldrBlock('no tldr here', 'alice', FERRY_BOT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.skipped).toBe(true);
  });

  it('reports missing fields with their names (not "out of order") when fewer than 6 fields present', () => {
    const partial = `<!-- ferry:tldr -->
| Field | Value |
|---|---|
| Ships | x |
| Touches | 1 file / +1 |
| Risk | low |
<!-- /ferry:tldr -->`;
    const r = validateTldrBlock(partial, FERRY_BOT, FERRY_BOT);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/missing required field/i);
      expect(r.message).toContain('Tests');
      expect(r.message).toContain('Rollback');
      expect(r.message).toContain('Reviewer verdict');
      expect(r.message).not.toMatch(/out of order/i);
    }
  });
});
