import { describe, it, expect } from 'vitest';
import {
  formatPullRequestTitle,
  formatPullRequestBody,
  transitionToReview,
  DRAFT_PR_OPTS,
} from './pr.js';

describe('formatPullRequestTitle (Story 4-4 FR16)', () => {
  it('prefixes with the ticket key (no brackets)', () => {
    expect(formatPullRequestTitle({ ticketKey: 'CHAN-27', summary: 'Add login button' })).toBe(
      'CHAN-27 Add login button',
    );
  });
});

describe('formatPullRequestBody (Story 4-4)', () => {
  const base = {
    ticketKey: 'CHAN-27',
    jiraBaseUrl: 'https://example.atlassian.net',
    runId: '01HXYZ',
    summary: 'Adds a login button to the home page.',
    subtasks: ['- [CHAN-28] Design button', '- [CHAN-29] Wire click handler'],
    validation: [
      { command: 'npm test', outcome: '42 tests passed' },
      { command: 'npm run typecheck', outcome: 'no errors' },
    ],
    notes: ['Removed unused auth helper', 'Follow-up: add tooltip in CHAN-30'],
  };

  it('contains the four required sections in order', () => {
    const body = formatPullRequestBody(base);
    const summaryIdx = body.indexOf('## Summary');
    const subtasksIdx = body.indexOf('## Included subtasks');
    const validationIdx = body.indexOf('## Validation');
    const notesIdx = body.indexOf('## Notes');
    expect(summaryIdx).toBeGreaterThan(-1);
    expect(subtasksIdx).toBeGreaterThan(summaryIdx);
    expect(validationIdx).toBeGreaterThan(subtasksIdx);
    expect(notesIdx).toBeGreaterThan(validationIdx);
  });

  it('includes Jira link and idempotency prefix in footer', () => {
    const body = formatPullRequestBody(base);
    expect(body).toContain('https://example.atlassian.net/browse/CHAN-27');
    expect(body).toContain('[ferry:dev:01HXYZ]');
  });

  it('renders subtasks list', () => {
    const body = formatPullRequestBody(base);
    expect(body).toContain('[CHAN-28] Design button');
    expect(body).toContain('[CHAN-29] Wire click handler');
  });

  it('renders validation entries with command and outcome', () => {
    const body = formatPullRequestBody(base);
    expect(body).toContain('`npm test` — 42 tests passed');
    expect(body).toContain('`npm run typecheck` — no errors');
  });

  it('renders notes list', () => {
    const body = formatPullRequestBody(base);
    expect(body).toContain('Removed unused auth helper');
    expect(body).toContain('Follow-up: add tooltip in CHAN-30');
  });

  it('renders _None_ for empty subtasks', () => {
    const body = formatPullRequestBody({ ...base, subtasks: [] });
    expect(body).toContain('## Included subtasks\n_None_');
  });

  it('renders _None_ for empty validation', () => {
    const body = formatPullRequestBody({ ...base, validation: [] });
    expect(body).toContain('## Validation\n_None_');
  });

  it('renders _None_ for empty notes', () => {
    const body = formatPullRequestBody({ ...base, notes: [] });
    expect(body).toContain('## Notes\n_None_');
  });

  it('strips trailing slash from jiraBaseUrl', () => {
    const body = formatPullRequestBody({ ...base, jiraBaseUrl: 'https://example.atlassian.net/' });
    expect(body).toContain('https://example.atlassian.net/browse/CHAN-27');
    expect(body).not.toContain('//browse');
  });

  it('keeps the body trim-able (no trailing spaces, ends with newline)', () => {
    const body = formatPullRequestBody(base);
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
