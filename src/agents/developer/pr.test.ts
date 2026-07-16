import { describe, it, expect, vi } from 'vitest';
import type { CIRunner } from '../../lib/dispatch/runner/types.js';
import {
  addReviewingLabelForBranch,
  formatPullRequestTitle,
  formatPullRequestBody,
  REVIEWING_LABEL,
} from './pr.js';

describe('formatPullRequestTitle (Story 4-4 FR16)', () => {
  it('prefixes with the ticket key (no brackets)', () => {
    expect(formatPullRequestTitle({ ticketKey: 'CHAN-27', summary: 'Add login button' })).toBe(
      'CHAN-27 Add login button',
    );
  });

  it('uses the summary verbatim — dev-action must pass issue.summary not done.summary', () => {
    // Regression for #250: dev-action was using done.summary (LLM output) instead of
    // issue.summary (verbatim Jira title). The call site fix is in dev-action.ts.
    const issueSummary = 'Fix login on mobile';
    const doneSummary = 'Implemented mobile authentication improvements';
    expect(formatPullRequestTitle({ ticketKey: 'PROJ-123', summary: issueSummary })).toBe(
      'PROJ-123 Fix login on mobile',
    );
    expect(formatPullRequestTitle({ ticketKey: 'PROJ-123', summary: doneSummary })).not.toBe(
      'PROJ-123 Fix login on mobile',
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

describe('addReviewingLabelForBranch', () => {
  function makeRunner(prs: Array<{ number: number }>): CIRunner {
    return {
      listPRsForBranch: vi.fn().mockResolvedValue(prs),
      addLabelsToPR: vi.fn().mockResolvedValue(undefined),
    } as unknown as CIRunner;
  }

  it('adds the ferry:reviewing label to the open PR for the developer branch', async () => {
    const runner = makeRunner([{ number: 411 }]);

    const prNumber = await addReviewingLabelForBranch(runner, 'big-emotion', 'ferry', 'ferry/FR-1');

    expect(prNumber).toBe(411);
    expect(runner.listPRsForBranch).toHaveBeenCalledWith('big-emotion', 'ferry', 'ferry/FR-1');
    expect(runner.addLabelsToPR).toHaveBeenCalledWith(
      { owner: 'big-emotion', repo: 'ferry', prNumber: 411 },
      [REVIEWING_LABEL],
    );
  });

  it('returns undefined and skips labeling when the branch has no open PR', async () => {
    const runner = makeRunner([]);

    await expect(
      addReviewingLabelForBranch(runner, 'big-emotion', 'ferry', 'ferry/FR-404'),
    ).resolves.toBeUndefined();

    expect(runner.addLabelsToPR).not.toHaveBeenCalled();
  });
});
