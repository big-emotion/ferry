import { describe, it, expect } from 'vitest';
import { applyRubricToPrompt } from './rubric.js';

const BASE = 'You are a reviewer. Review the PR.';

describe('applyRubricToPrompt', () => {
  it('returns the base prompt unchanged when rubric is undefined', () => {
    expect(applyRubricToPrompt(BASE, undefined)).toBe(BASE);
  });

  it('appends the strict directive when rubric is "strict"', () => {
    const out = applyRubricToPrompt(BASE, 'strict');
    expect(out).toContain(BASE);
    expect(out).toMatch(/Rubric override — strict/);
    expect(out).toMatch(/STRICTER bar/);
  });

  it('appends the lenient directive when rubric is "lenient"', () => {
    const out = applyRubricToPrompt(BASE, 'lenient');
    expect(out).toContain(BASE);
    expect(out).toMatch(/Rubric override — lenient/);
    expect(out).toMatch(/MORE PERMISSIVE bar/);
  });

  it('strict and lenient produce different prompts', () => {
    expect(applyRubricToPrompt(BASE, 'strict')).not.toBe(applyRubricToPrompt(BASE, 'lenient'));
  });

  it('the directive is appended at the end (after the base prompt)', () => {
    const out = applyRubricToPrompt(BASE, 'strict');
    expect(out.indexOf(BASE)).toBeLessThan(out.indexOf('Rubric override'));
  });

  it('produces a prompt that contains a horizontal-rule separator', () => {
    const out = applyRubricToPrompt(BASE, 'strict');
    expect(out).toContain('\n---\n');
  });
});
