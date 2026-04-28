import { describe, expect, it } from 'vitest';
import {
  TLDR_FIELD_ORDER,
  buildTldrBlock,
  updateReviewerVerdictField,
  upsertTldrInBody,
} from './tldr.js';
import { FerryError } from '../error.js';

const baseInput = {
  ships: 'replace flaky session refresh with explicit revoke endpoint',
  touches_files: 4,
  touches_lines: 132,
  risk_level: 'medium' as const,
  risk_justification: 'Touches the auth middleware on a critical path.',
  tests: '12 new unit tests + 1 dry-run E2E added.',
  rollback: 'git revert <sha>',
  reviewer_verdict: 'pending — awaiting review',
};

describe('TL;DR block', () => {
  it('builds a 6-field block wrapped in ferry:tldr markers', () => {
    const block = buildTldrBlock(baseInput);
    expect(block).toContain('<!-- ferry:tldr -->');
    expect(block).toContain('<!-- /ferry:tldr -->');
    expect(block).toContain('| Ships |');
    expect(block).toContain('| Touches |');
    expect(block).toContain('| Risk |');
    expect(block).toContain('| Tests |');
    expect(block).toContain('| Rollback |');
    expect(block).toContain('| Reviewer verdict |');
  });

  it('rejects blocks longer than 500 characters with FerryError(state-invariant)', () => {
    let caught: unknown;
    try {
      buildTldrBlock({ ...baseInput, ships: 'x'.repeat(600) });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FerryError);
    expect((caught as FerryError).code).toBe('state-invariant');
    expect((caught as FerryError).context).toMatchObject({ reason: 'tldr-too-long' });
  });

  it('emits the six fields in the canonical order (Ships, Touches, Risk, Tests, Rollback, Reviewer verdict)', () => {
    const block = buildTldrBlock(baseInput);
    const positions = TLDR_FIELD_ORDER.map((name) => block.indexOf(`| ${name} |`));
    for (const p of positions) expect(p).toBeGreaterThan(-1);
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });

  it('upsertTldrInBody yields exactly one blank line before existing body, regardless of trailing newline', () => {
    const withTrailingNl = upsertTldrInBody('existing body\n', baseInput);
    const withoutTrailingNl = upsertTldrInBody('existing body', baseInput);
    // Both should end with: <close>\n\nexisting body[\n]
    expect(withTrailingNl).toContain('<!-- /ferry:tldr -->\n\nexisting body');
    expect(withoutTrailingNl).toContain('<!-- /ferry:tldr -->\n\nexisting body');
    // Never 3 consecutive newlines after the close marker.
    expect(withTrailingNl).not.toContain('<!-- /ferry:tldr -->\n\n\n');
    expect(withoutTrailingNl).not.toContain('<!-- /ferry:tldr -->\n\n\n');
  });

  it('upsertTldrInBody is idempotent on re-write', () => {
    const body1 = upsertTldrInBody('', baseInput);
    const body2 = upsertTldrInBody(body1, baseInput);
    const occurrences = body2.match(/<!-- ferry:tldr -->/g) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it('updateReviewerVerdictField updates only that row', () => {
    const body1 = upsertTldrInBody('', baseInput);
    const body2 = updateReviewerVerdictField(body1, 'merge-ready: ship it');
    expect(body2).toContain('merge-ready: ship it');
    expect(body2).not.toContain('pending — awaiting review');
  });

  it('updateReviewerVerdictField truncates verdict text > 40 chars', () => {
    const body1 = upsertTldrInBody('', baseInput);
    const verdict = 'x'.repeat(60);
    const body2 = updateReviewerVerdictField(body1, verdict);
    const m = body2.match(/\| Reviewer verdict \| (.+?) \|/);
    expect(m).not.toBeNull();
    expect((m?.[1] ?? '').length).toBeLessThanOrEqual(40);
  });
});
