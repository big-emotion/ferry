import { describe, it, expect } from 'vitest';
import {
  CC_OUTPUT_ARTIFACT_PATH,
  parseDevIterArtifact,
  parseReviewerArtifact,
  parseRefinerArtifact,
  parseClaudeCodeArtifact,
  outcomePromptSuffix,
} from './output-artifact.js';

describe('CC_OUTPUT_ARTIFACT_PATH', () => {
  it('is the fixed repo-relative artifact path', () => {
    expect(CC_OUTPUT_ARTIFACT_PATH).toBe('.ferry/cc-output.json');
  });
});

describe('parseDevIterArtifact (≈ script `done` outcome)', () => {
  it('parses an implemented outcome and derives actionable=true', () => {
    const out = parseDevIterArtifact({
      outcome: 'implemented',
      summary: 'Added the feature',
      commit_message: 'feat: add feature',
      validation: [{ command: 'npm test', outcome: '10 passed' }],
      notes: ['follow-up: docs'],
    });
    expect(out).toEqual({
      actionable: true,
      outcome: 'implemented',
      summary: 'Added the feature',
      commit_message: 'feat: add feature',
      validation: [{ command: 'npm test', outcome: '10 passed' }],
      notes: ['follow-up: docs'],
    });
  });

  it('derives actionable=true for already_satisfied', () => {
    expect(
      parseDevIterArtifact({ outcome: 'already_satisfied', summary: 'nothing to do' }),
    ).toMatchObject({ actionable: true, outcome: 'already_satisfied' });
  });

  it('derives actionable=false for blocked and keeps reason', () => {
    expect(
      parseDevIterArtifact({
        outcome: 'blocked',
        summary: 'cannot proceed',
        reason: 'missing API',
      }),
    ).toMatchObject({ actionable: false, outcome: 'blocked', reason: 'missing API' });
  });

  it.each([
    ['not an object', 'nope'],
    ['null', null],
    ['missing summary', { outcome: 'implemented' }],
    ['empty summary', { outcome: 'implemented', summary: '   ' }],
    ['missing outcome', { summary: 'x' }],
    ['invalid outcome', { outcome: 'done', summary: 'x' }],
    ['validation wrong type', { outcome: 'implemented', summary: 'x', validation: 'bad' }],
    ['notes wrong type', { outcome: 'implemented', summary: 'x', notes: [1, 2] }],
  ])('fail-closed: throws on %s', (_label, bad) => {
    expect(() => parseDevIterArtifact(bad)).toThrow(/cc-output/i);
  });
});

describe('parseReviewerArtifact (≈ script `finish_review` outcome)', () => {
  it('parses an approved verdict', () => {
    expect(parseReviewerArtifact({ approved: true, comment: 'LGTM' })).toEqual({
      approved: true,
      comment: 'LGTM',
    });
  });

  it('parses a changes-requested verdict', () => {
    expect(parseReviewerArtifact({ approved: false, comment: 'fix X' })).toEqual({
      approved: false,
      comment: 'fix X',
    });
  });

  it.each([
    ['not an object', 42],
    ['missing approved', { comment: 'x' }],
    ['approved not boolean', { approved: 'yes', comment: 'x' }],
    ['missing comment', { approved: true }],
    ['empty comment', { approved: true, comment: '' }],
  ])('fail-closed: throws on %s', (_label, bad) => {
    expect(() => parseReviewerArtifact(bad)).toThrow(/cc-output/i);
  });
});

describe('parseRefinerArtifact (≈ REFINER_OUTPUT_SCHEMA shape)', () => {
  const valid = {
    actions: [
      { type: 'create', title: 'T', description: 'D' },
      { type: 'noop', reason: 'unchanged' },
    ],
    touch_paths: ['src/a.ts'],
    output_locale: 'en',
    audit_summary: 'refined 1 subtask',
  };

  it('parses a valid refiner output verbatim', () => {
    expect(parseRefinerArtifact(valid)).toEqual(valid);
  });

  it('accepts the optional attachments/cost_estimate fields', () => {
    const withOpt = { ...valid, attachments: ['x.png'] };
    expect(parseRefinerArtifact(withOpt)).toEqual(withOpt);
  });

  it.each([
    ['not an object', null],
    ['missing actions', { touch_paths: [], output_locale: 'en', audit_summary: 'a' }],
    ['empty actions', { ...valid, actions: [] }],
    ['unknown action type', { ...valid, actions: [{ type: 'delete', existing_key: 'K' }] }],
    ['bad output_locale', { ...valid, output_locale: 'de' }],
    ['empty audit_summary', { ...valid, audit_summary: '' }],
    ['touch_paths not string[]', { ...valid, touch_paths: [1] }],
  ])('fail-closed: throws on %s', (_label, bad) => {
    expect(() => parseRefinerArtifact(bad)).toThrow(/cc-output/i);
  });
});

describe('parseClaudeCodeArtifact (role dispatch)', () => {
  it('routes developer/iterator to the done parser', () => {
    expect(
      parseClaudeCodeArtifact('developer', { outcome: 'blocked', summary: 's' }),
    ).toMatchObject({ actionable: false });
    expect(
      parseClaudeCodeArtifact('iterator', { outcome: 'implemented', summary: 's' }),
    ).toMatchObject({ outcome: 'implemented' });
  });

  it('routes reviewer to the verdict parser', () => {
    expect(parseClaudeCodeArtifact('reviewer', { approved: true, comment: 'ok' })).toEqual({
      approved: true,
      comment: 'ok',
    });
  });

  it('routes refiner to the refiner parser', () => {
    const r = {
      actions: [{ type: 'noop', reason: 'x' }],
      touch_paths: [],
      output_locale: 'fr',
      audit_summary: 'rien',
    };
    expect(parseClaudeCodeArtifact('refiner', r)).toEqual(r);
  });

  it('throws on an unknown role (fail-closed)', () => {
    // @ts-expect-error intentional bad role
    expect(() => parseClaudeCodeArtifact('ghost', {})).toThrow(/unknown ferry role/i);
  });
});

describe('outcomePromptSuffix', () => {
  it('instructs every role to write the artifact at the fixed path and not call removed tools', () => {
    for (const role of ['refiner', 'developer', 'reviewer', 'iterator'] as const) {
      const s = outcomePromptSuffix(role);
      expect(s).toContain(CC_OUTPUT_ARTIFACT_PATH);
      expect(s.toLowerCase()).toContain('json');
    }
  });

  it('tells dev/iter to commit via git (commit_progress has no terminal artifact)', () => {
    expect(outcomePromptSuffix('developer').toLowerCase()).toContain('git');
    expect(outcomePromptSuffix('iterator').toLowerCase()).toContain('git');
  });

  it('tells reviewer/refiner the expected verdict keys', () => {
    expect(outcomePromptSuffix('reviewer')).toContain('approved');
    expect(outcomePromptSuffix('refiner')).toContain('actions');
  });
});
