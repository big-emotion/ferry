import { describe, it, expect, vi } from 'vitest';
import type { Octokit } from '@octokit/rest';
import { emitAudit, type AuditPayload, type AuditOpts } from './index.js';

const RUN_ID = '01JFBK9Q4BVCJAGTYQ6S3XTDMN';

function makeMockOctokit(existingComments: string[] = []): Octokit {
  return {
    rest: {
      issues: {
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
    const call = (octokit.rest.issues.createComment as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    const lines = call.body.split('\n');
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
    const call = (octokit.rest.issues.createComment as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.body).toMatch(new RegExp(`^\\[ferry:audit:${RUN_ID}\\]\\n`));
  });

  it('duration_ms is a non-negative integer', async () => {
    const octokit = makeMockOctokit();
    await emitAudit(PAYLOAD, { ...OPTS, octokit });
    const call = (octokit.rest.issues.createComment as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    const json = JSON.parse(call.body.split('\n')[1]);
    expect(json.duration_ms).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(json.duration_ms)).toBe(true);
  });

  it('timestamp is a valid ISO-8601 string', async () => {
    const octokit = makeMockOctokit();
    await emitAudit(PAYLOAD, { ...OPTS, octokit });
    const call = (octokit.rest.issues.createComment as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    const json = JSON.parse(call.body.split('\n')[1]);
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
    const call = (octokit.rest.issues.createComment as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    const json = JSON.parse(call.body.split('\n')[1]);
    expect(json.input_tokens).toBe(0);
    expect(json.output_tokens).toBe(0);
    expect(json.cost_eur).toBe(0);
  });
});
