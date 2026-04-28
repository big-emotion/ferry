import { describe, it, expect } from 'vitest';
import {
  formatPullRequestTitle,
  formatPullRequestBody,
  transitionToReview,
  DRAFT_PR_OPTS,
} from './pr.js';

describe('formatPullRequestTitle (Story 4-4 FR16)', () => {
  it('prefixes the ticket key in brackets', () => {
    expect(formatPullRequestTitle({ ticketKey: 'CHAN-27', summary: 'Add login button' })).toBe(
      '[CHAN-27] Add login button',
    );
  });
});

describe('formatPullRequestBody (Story 4-4)', () => {
  it('includes Jira link, run id, and TLDR', () => {
    const body = formatPullRequestBody({
      ticketKey: 'CHAN-27',
      jiraBaseUrl: 'https://example.atlassian.net',
      runId: '01HXYZ',
      tldr: 'Adds a login button to the home page.',
    });
    expect(body).toContain('https://example.atlassian.net/browse/CHAN-27');
    expect(body).toContain('01HXYZ');
    expect(body).toContain('Adds a login button to the home page.');
  });

  it('keeps the body trim-able (no trailing spaces, ends with newline)', () => {
    const body = formatPullRequestBody({
      ticketKey: 'CHAN-1',
      jiraBaseUrl: 'https://j',
      runId: 'r1',
      tldr: 't',
    });
    expect(body).not.toMatch(/ +\n/);
    expect(body.endsWith('\n')).toBe(true);
  });
});

describe('transitionToReview (Story 4-4 FR18)', () => {
  it('sets phase=reviewing and pr_number while preserving other fields', () => {
    const state = { ticket_key: 'CHAN-27', phase: 'developing', other: 'preserved' };
    const next = transitionToReview({ state, prNumber: 42 });
    expect(next.phase).toBe('reviewing');
    expect(next.pr_number).toBe(42);
    expect(next.other).toBe('preserved');
    expect(state.phase).toBe('developing'); // input not mutated
  });
});

describe('DRAFT_PR_OPTS', () => {
  it('is { draft: true }', () => {
    expect(DRAFT_PR_OPTS).toEqual({ draft: true });
  });
});
