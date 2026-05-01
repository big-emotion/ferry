import { describe, it, expect, vi } from 'vitest';
import type { Octokit } from '@octokit/rest';
import {
  emitAudit,
  rotateAuditIssue,
  findActiveAuditIssue,
  ROTATION_THRESHOLD,
  AUDIT_ACTIVE_LABEL,
  type AuditPayload,
  type AuditOpts,
} from './index.js';

const RUN_ID = '01JFBK9Q4BVCJAGTYQ6S3XTDMN';

function makeMockOctokit(existingComments: string[] = [], commentCount = 0): Octokit {
  return {
    rest: {
      issues: {
        get: vi.fn().mockResolvedValue({
          data: { number: 42, title: 'Ferry Audit Log (#1)', comments: commentCount, labels: [] },
        }),
        listForRepo: vi.fn().mockResolvedValue({ data: [] }),
        create: vi.fn().mockResolvedValue({ data: { number: 99 } }),
        removeLabel: vi.fn().mockResolvedValue({}),
        listComments: vi.fn().mockResolvedValue({
          data: existingComments.map((body, i) => ({ id: i + 1, body })),
        }),
        createComment: vi.fn().mockResolvedValue({ data: { id: 99 } }),
      },
    },
  } as unknown as Octokit;
}

const PAYLOAD: AuditPayload = {
  ticket: 'CHAN-27',
  phase: 'refine',
  runId: RUN_ID,
  model: 'gemini-2.5-flash',
  outcome: 'success',
  usage: { inputTokens: 100, outputTokens: 50, costEur: 0.0012 },
  start: Date.now() - 5000,
};

const OPTS: AuditOpts = {
  octokit: {} as Octokit,
  owner: 'org',
  repo: 'target',
  auditIssue: 42,
};

describe('emitAudit', () => {
  it('calls createComment exactly once', async () => {
    const octokit = makeMockOctokit();
    await emitAudit(PAYLOAD, { ...OPTS, octokit });
    expect(octokit.rest.issues.createComment).toHaveBeenCalledOnce();
  });

  it('comment body is valid JSON with all required fields', async () => {
    const octokit = makeMockOctokit();
    await emitAudit(PAYLOAD, { ...OPTS, octokit });
    const call = vi.mocked(octokit.rest.issues.createComment).mock.calls[0][0];
    const lines = (call as { body: string }).body.split('\n');
    const json = JSON.parse(lines[1]);
    expect(json).toMatchObject({
      ticket: expect.any(String),
      phase: expect.any(String),
      run_id: expect.any(String),
      model: expect.any(String),
      input_tokens: expect.any(Number),
      output_tokens: expect.any(Number),
      cost_eur: expect.any(Number),
      outcome: expect.any(String),
      duration_ms: expect.any(Number),
      timestamp: expect.any(String),
    });
  });

  it('comment body starts with idempotency marker on first line', async () => {
    const octokit = makeMockOctokit();
    await emitAudit(PAYLOAD, { ...OPTS, octokit });
    const call = vi.mocked(octokit.rest.issues.createComment).mock.calls[0][0];
    expect((call as { body: string }).body).toMatch(new RegExp(`^\\[ferry:audit:${RUN_ID}\\]\\n`));
  });

  it('duration_ms is a non-negative integer', async () => {
    const octokit = makeMockOctokit();
    await emitAudit(PAYLOAD, { ...OPTS, octokit });
    const call = vi.mocked(octokit.rest.issues.createComment).mock.calls[0][0];
    const json = JSON.parse((call as { body: string }).body.split('\n')[1]);
    expect(json.duration_ms).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(json.duration_ms)).toBe(true);
  });

  it('timestamp is a valid ISO-8601 string', async () => {
    const octokit = makeMockOctokit();
    await emitAudit(PAYLOAD, { ...OPTS, octokit });
    const call = vi.mocked(octokit.rest.issues.createComment).mock.calls[0][0];
    const json = JSON.parse((call as { body: string }).body.split('\n')[1]);
    expect(() => new Date(json.timestamp).toISOString()).not.toThrow();
    expect(json.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('skips createComment if idempotency marker already exists', async () => {
    const existingMarker = `[ferry:audit:${RUN_ID}]\n{"ticket":"CHAN-27"}`;
    const octokit = makeMockOctokit([existingMarker]);
    await emitAudit(PAYLOAD, { ...OPTS, octokit });
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it('defaults tokens and cost to 0 when usage is null', async () => {
    const octokit = makeMockOctokit();
    await emitAudit({ ...PAYLOAD, usage: null }, { ...OPTS, octokit });
    const call = vi.mocked(octokit.rest.issues.createComment).mock.calls[0][0];
    const json = JSON.parse((call as { body: string }).body.split('\n')[1]);
    expect(json.input_tokens).toBe(0);
    expect(json.output_tokens).toBe(0);
    expect(json.cost_eur).toBe(0);
  });

  it('returns no rotatedTo when below threshold', async () => {
    const octokit = makeMockOctokit([], ROTATION_THRESHOLD - 1);
    const result = await emitAudit(PAYLOAD, { ...OPTS, octokit });
    expect(result.rotatedTo).toBeUndefined();
  });
});

describe('at-cap behavior', () => {
  function makeCapMockOctokit(opts: {
    commentCount: number;
    activeLabelIssue?: number | null;
    newIssueNumber?: number;
  }): Octokit {
    const { commentCount, activeLabelIssue = null, newIssueNumber = 99 } = opts;

    const getImpl = vi.fn().mockImplementation(({ issue_number }: { issue_number: number }) => {
      return Promise.resolve({
        data: {
          number: issue_number,
          title: issue_number === 42 ? 'Ferry Audit Log (#1)' : `Ferry Audit Log (#2)`,
          comments: issue_number === 42 ? commentCount : 0,
          labels: [],
        },
      });
    });

    return {
      rest: {
        issues: {
          get: getImpl,
          listForRepo: vi
            .fn()
            .mockResolvedValue(
              activeLabelIssue !== null ? { data: [{ number: activeLabelIssue }] } : { data: [] },
            ),
          create: vi.fn().mockResolvedValue({ data: { number: newIssueNumber } }),
          removeLabel: vi.fn().mockResolvedValue({}),
          listComments: vi.fn().mockResolvedValue({ data: [] }),
          createComment: vi.fn().mockResolvedValue({ data: { id: 100 } }),
        },
      },
    } as unknown as Octokit;
  }

  it('does not rotate when one below threshold', async () => {
    const octokit = makeCapMockOctokit({ commentCount: ROTATION_THRESHOLD - 1 });
    const result = await emitAudit(PAYLOAD, { ...OPTS, octokit });
    expect(result.rotatedTo).toBeUndefined();
    expect(octokit.rest.issues.create).not.toHaveBeenCalled();
  });

  it('rotates when exactly at threshold', async () => {
    const octokit = makeCapMockOctokit({ commentCount: ROTATION_THRESHOLD, newIssueNumber: 99 });
    const result = await emitAudit(PAYLOAD, { ...OPTS, octokit });
    expect(result.rotatedTo).toBe(99);
  });

  it('rotates when over threshold', async () => {
    const octokit = makeCapMockOctokit({ commentCount: 950, newIssueNumber: 99 });
    const result = await emitAudit(PAYLOAD, { ...OPTS, octokit });
    expect(result.rotatedTo).toBe(99);
  });

  it('writes audit comment to new issue after rotation', async () => {
    const octokit = makeCapMockOctokit({ commentCount: ROTATION_THRESHOLD, newIssueNumber: 99 });
    await emitAudit(PAYLOAD, { ...OPTS, octokit });

    const calls = vi.mocked(octokit.rest.issues.createComment).mock.calls;
    const auditWrite = calls.find(
      (c) =>
        c[0]!.issue_number === 99 &&
        typeof (c[0] as { body: string }).body === 'string' &&
        (c[0] as { body: string }).body.includes(`[ferry:audit:${RUN_ID}]`),
    );
    expect(auditWrite).toBeDefined();
  });

  it('does not write audit comment to old issue after rotation', async () => {
    const octokit = makeCapMockOctokit({ commentCount: ROTATION_THRESHOLD, newIssueNumber: 99 });
    await emitAudit(PAYLOAD, { ...OPTS, octokit });

    const calls = vi.mocked(octokit.rest.issues.createComment).mock.calls;
    const oldIssueAudit = calls.find(
      (c) =>
        c[0]!.issue_number === 42 &&
        (c[0] as { body: string }).body.includes(`[ferry:audit:${RUN_ID}]`),
    );
    expect(oldIssueAudit).toBeUndefined();
  });
});

describe('successor creation', () => {
  it('creates successor with incremented sequence number', async () => {
    const octokit = {
      rest: {
        issues: {
          get: vi
            .fn()
            .mockResolvedValue({ data: { number: 42, title: 'Ferry Audit Log (#1)', labels: [] } }),
          create: vi.fn().mockResolvedValue({ data: { number: 99 } }),
          removeLabel: vi.fn().mockResolvedValue({}),
          createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }),
        },
      },
    } as unknown as Octokit;

    await rotateAuditIssue(octokit, 'org', 'repo', 42);

    expect(octokit.rest.issues.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Ferry Audit Log (#2)' }),
    );
  });

  it('increments sequence from any starting number', async () => {
    const octokit = {
      rest: {
        issues: {
          get: vi
            .fn()
            .mockResolvedValue({ data: { number: 7, title: 'Ferry Audit Log (#5)', labels: [] } }),
          create: vi.fn().mockResolvedValue({ data: { number: 200 } }),
          removeLabel: vi.fn().mockResolvedValue({}),
          createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }),
        },
      },
    } as unknown as Octokit;

    await rotateAuditIssue(octokit, 'org', 'repo', 7);

    expect(octokit.rest.issues.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Ferry Audit Log (#6)' }),
    );
  });

  it('labels successor with AUDIT_ACTIVE_LABEL', async () => {
    const octokit = {
      rest: {
        issues: {
          get: vi
            .fn()
            .mockResolvedValue({ data: { number: 42, title: 'Ferry Audit Log (#1)', labels: [] } }),
          create: vi.fn().mockResolvedValue({ data: { number: 99 } }),
          removeLabel: vi.fn().mockResolvedValue({}),
          createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }),
        },
      },
    } as unknown as Octokit;

    await rotateAuditIssue(octokit, 'org', 'repo', 42);

    expect(octokit.rest.issues.create).toHaveBeenCalledWith(
      expect.objectContaining({ labels: expect.arrayContaining([AUDIT_ACTIVE_LABEL]) }),
    );
  });

  it('posts rotation link comment on old issue', async () => {
    const octokit = {
      rest: {
        issues: {
          get: vi
            .fn()
            .mockResolvedValue({ data: { number: 42, title: 'Ferry Audit Log (#1)', labels: [] } }),
          create: vi.fn().mockResolvedValue({ data: { number: 99 } }),
          removeLabel: vi.fn().mockResolvedValue({}),
          createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }),
        },
      },
    } as unknown as Octokit;

    await rotateAuditIssue(octokit, 'org', 'repo', 42);

    const calls = vi.mocked(octokit.rest.issues.createComment).mock.calls;
    const linkComment = calls.find(
      (c) =>
        c[0]!.issue_number === 42 &&
        (c[0] as { body: string }).body.startsWith('[ferry:audit:rotation]'),
    );
    expect(linkComment).toBeDefined();
    expect((linkComment![0] as { body: string }).body).toContain('#99');
  });

  it('handles legacy title without sequence number (defaults to seq 1)', async () => {
    const octokit = {
      rest: {
        issues: {
          get: vi
            .fn()
            .mockResolvedValue({ data: { number: 42, title: 'Ferry — Audit log', labels: [] } }),
          create: vi.fn().mockResolvedValue({ data: { number: 99 } }),
          removeLabel: vi.fn().mockResolvedValue({}),
          createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }),
        },
      },
    } as unknown as Octokit;

    await rotateAuditIssue(octokit, 'org', 'repo', 42);

    expect(octokit.rest.issues.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Ferry Audit Log (#2)' }),
    );
  });

  it('returns the new issue number', async () => {
    const octokit = {
      rest: {
        issues: {
          get: vi
            .fn()
            .mockResolvedValue({ data: { number: 42, title: 'Ferry Audit Log (#1)', labels: [] } }),
          create: vi.fn().mockResolvedValue({ data: { number: 200 } }),
          removeLabel: vi.fn().mockResolvedValue({}),
          createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }),
        },
      },
    } as unknown as Octokit;

    const result = await rotateAuditIssue(octokit, 'org', 'repo', 42);

    expect(result).toBe(200);
  });
});

describe('stale variable detection', () => {
  it('uses active-label issue when configured issue is at capacity but another is active', async () => {
    const octokit = {
      rest: {
        issues: {
          get: vi.fn().mockResolvedValue({
            data: {
              number: 42,
              title: 'Ferry Audit Log (#1)',
              comments: ROTATION_THRESHOLD,
              labels: [],
            },
          }),
          listForRepo: vi.fn().mockResolvedValue({ data: [{ number: 55 }] }),
          create: vi.fn(),
          removeLabel: vi.fn(),
          listComments: vi.fn().mockResolvedValue({ data: [] }),
          createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }),
        },
      },
    } as unknown as Octokit;

    const result = await emitAudit(PAYLOAD, { ...OPTS, octokit });

    // Should use issue 55 (already-active successor), not create a new one
    expect(result.rotatedTo).toBe(55);
    expect(octokit.rest.issues.create).not.toHaveBeenCalled();

    // Audit comment written to issue 55
    const calls = vi.mocked(octokit.rest.issues.createComment).mock.calls;
    expect(calls.some((c) => c[0]!.issue_number === 55)).toBe(true);
  });

  it('creates new successor when at capacity and no active label issue exists', async () => {
    const octokit = {
      rest: {
        issues: {
          get: vi.fn().mockImplementation(({ issue_number }: { issue_number: number }) =>
            Promise.resolve({
              data: {
                number: issue_number,
                title: issue_number === 42 ? 'Ferry Audit Log (#1)' : 'Ferry Audit Log (#2)',
                comments: issue_number === 42 ? ROTATION_THRESHOLD : 0,
                labels: [],
              },
            }),
          ),
          listForRepo: vi.fn().mockResolvedValue({ data: [] }),
          create: vi.fn().mockResolvedValue({ data: { number: 99 } }),
          removeLabel: vi.fn().mockResolvedValue({}),
          listComments: vi.fn().mockResolvedValue({ data: [] }),
          createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }),
        },
      },
    } as unknown as Octokit;

    const result = await emitAudit(PAYLOAD, { ...OPTS, octokit });

    expect(result.rotatedTo).toBe(99);
    expect(octokit.rest.issues.create).toHaveBeenCalledOnce();
  });
});

describe('findActiveAuditIssue', () => {
  it('returns null when no issue has the active label', async () => {
    const octokit = {
      rest: {
        issues: {
          listForRepo: vi.fn().mockResolvedValue({ data: [] }),
        },
      },
    } as unknown as Octokit;

    const result = await findActiveAuditIssue(octokit, 'org', 'repo');
    expect(result).toBeNull();
  });

  it('returns issue number when active label exists', async () => {
    const octokit = {
      rest: {
        issues: {
          listForRepo: vi.fn().mockResolvedValue({ data: [{ number: 77 }] }),
        },
      },
    } as unknown as Octokit;

    const result = await findActiveAuditIssue(octokit, 'org', 'repo');
    expect(result).toBe(77);
  });

  it('queries with the correct label', async () => {
    const octokit = {
      rest: {
        issues: {
          listForRepo: vi.fn().mockResolvedValue({ data: [] }),
        },
      },
    } as unknown as Octokit;

    await findActiveAuditIssue(octokit, 'org', 'repo');

    expect(octokit.rest.issues.listForRepo).toHaveBeenCalledWith(
      expect.objectContaining({ labels: AUDIT_ACTIVE_LABEL }),
    );
  });
});
