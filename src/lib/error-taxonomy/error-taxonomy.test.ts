import { describe, it, expect } from 'vitest';
import { mapError } from './index.js';
import { FerryError } from '../error.js';

describe('mapError', () => {
  it('maps transient to no labels and outcome transient', () => {
    const result = mapError(new FerryError('transient'));
    expect(result).toEqual({
      labels: [],
      outcome: 'transient',
      jiraCommentTemplate: expect.stringContaining('Retrying'),
    });
  });

  it('maps spend-cap to ferry:paused + ferry:spend-cap labels', () => {
    const result = mapError(new FerryError('spend-cap'));
    expect(result).toEqual({
      labels: ['ferry:paused', 'ferry:spend-cap'],
      outcome: 'spend-cap',
      jiraCommentTemplate: expect.stringContaining('billing'),
    });
  });

  it('maps state-invariant to status:stale label', () => {
    const result = mapError(new FerryError('state-invariant'));
    expect(result).toEqual({
      labels: ['status:stale'],
      outcome: 'state-invariant',
      jiraCommentTemplate: expect.stringContaining('stale'),
    });
  });

  it('maps oscillation to needs-human label', () => {
    const result = mapError(new FerryError('oscillation'));
    expect(result).toEqual({
      labels: ['needs-human'],
      outcome: 'oscillation',
      jiraCommentTemplate: expect.stringContaining('oscillation'),
    });
  });

  it('maps unknown to needs-human label', () => {
    const result = mapError(new FerryError('unknown'));
    expect(result).toEqual({
      labels: ['needs-human'],
      outcome: 'unknown',
      jiraCommentTemplate: expect.stringContaining('Unexpected'),
    });
  });

  it('maps plain Error (not FerryError) to unknown mapping', () => {
    const result = mapError(new Error('non-ferry'));
    expect(result).toEqual({
      labels: ['needs-human'],
      outcome: 'unknown',
      jiraCommentTemplate: expect.stringContaining('Unexpected'),
    });
  });

  it('includes context in the comment template when context is provided', () => {
    const result = mapError(new FerryError('unknown', { context: 'extra' }));
    expect(result.jiraCommentTemplate).toContain('extra');
  });
});
