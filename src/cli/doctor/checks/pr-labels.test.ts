import { describe, it, expect } from 'vitest';
import { checkPrLabels } from './pr-labels.js';
import { FERRY_PR_LABELS } from '../../init/steps/pr-labels.js';

const ALL = FERRY_PR_LABELS.map((l) => l.name);

describe('checkPrLabels', () => {
  it('is green when every Ferry label exists', () => {
    const result = checkPrLabels({ repo: 'acme/site' }, () => ALL);
    expect(result.status).toBe('green');
  });

  it('matches label names case-insensitively', () => {
    const result = checkPrLabels({ repo: 'acme/site' }, () => ALL.map((n) => n.toUpperCase()));
    expect(result.status).toBe('green');
  });

  it('is yellow and names the missing labels', () => {
    const result = checkPrLabels({ repo: 'acme/site' }, () =>
      ALL.filter((n) => n !== 'ci-green' && n !== 'approved'),
    );
    expect(result.status).toBe('yellow');
    expect(result.detail).toContain('ci-green');
    expect(result.detail).toContain('approved');
    expect(result.remedy).toContain('gh label create');
  });

  it('is yellow, not red, when the label list cannot be read', () => {
    const result = checkPrLabels({ repo: 'acme/site' }, () => null);
    expect(result.status).toBe('yellow');
    expect(result.detail).toMatch(/could not read/i);
  });
});
