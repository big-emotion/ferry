import { describe, expect, it } from 'vitest';
import { classifyHttpStatus, buildSpendCapPause } from './spend-cap.js';

describe('spend-cap classifier', () => {
  it('429 is classified as spend-cap (no retry)', () => {
    expect(classifyHttpStatus(429)).toBe('spend-cap');
  });

  it('402 is classified as spend-cap (no retry)', () => {
    expect(classifyHttpStatus(402)).toBe('spend-cap');
  });

  it('500 is classified as transient (retry)', () => {
    expect(classifyHttpStatus(500)).toBe('transient');
  });

  it('200 is classified as ok', () => {
    expect(classifyHttpStatus(200)).toBe('ok');
  });

  it('non-pause 4xx (400/401/403/404) are classified as unknown, NOT spend-cap', () => {
    expect(classifyHttpStatus(400)).toBe('unknown');
    expect(classifyHttpStatus(401)).toBe('unknown');
    expect(classifyHttpStatus(403)).toBe('unknown');
    expect(classifyHttpStatus(404)).toBe('unknown');
    expect(classifyHttpStatus(418)).toBe('unknown');
  });

  it('1xx and 3xx are classified as unknown (no auto-pause)', () => {
    expect(classifyHttpStatus(100)).toBe('unknown');
    expect(classifyHttpStatus(301)).toBe('unknown');
    expect(classifyHttpStatus(304)).toBe('unknown');
  });
});

describe('buildSpendCapPause', () => {
  it('builds the pause directive with both labels and a Jira comment', () => {
    const out = buildSpendCapPause({
      ticket_key: 'CHAN-27',
      role: 'developer',
      run_id: 'run-1',
    });
    expect(out.add_labels).toEqual(['ferry:paused', 'ferry:spend-cap']);
    expect(out.jira_comment).toContain('[ferry:developer:run-1]');
    expect(out.jira_comment).toContain('Paused');
    expect(out.audit_outcome).toBe('spend-cap');
  });
});
