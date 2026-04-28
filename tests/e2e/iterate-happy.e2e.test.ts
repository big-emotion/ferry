/**
 * Story 6-5 AC3 — dry-run E2E for the Iterator happy path:
 *   load history → mocked LLM call → apply diff (mocked) → commit → transition → audit
 *
 * Pure-logic stitch: no real git, no real GitHub, no real LLM. Each side
 * effect is replaced with a deterministic stub so the test asserts the full
 * shape of the transition decision and the iteration increment.
 */

import { describe, expect, it, vi } from 'vitest';
import { buildIteratorPrompt, formatCommitMessage } from '../../src/agents/iterator/prompt.js';
import { decideIteratorTransition } from '../../src/agents/iterator/transition.js';
import { checkIterationCap } from '../../src/agents/iterator/cap.js';

interface MockLlmResponse {
  diff: string;
  summary: string;
  rule_ids: string[];
}

function mockLlmCall(prompt: string): MockLlmResponse {
  // Deterministic mock: the prompt content is exercised but the response is fixed.
  expect(prompt).toContain('Ticket: PROJ-123');
  return {
    diff: '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-foo\n+bar\n',
    summary: 'rename foo to bar',
    rule_ids: ['eslint/no-unused-vars'],
  };
}

function mockGitApply(diff: string): { applied: true; changedPaths: string[] } {
  expect(diff).toContain('+bar');
  return { applied: true, changedPaths: ['src/foo.ts'] };
}

function mockGitCommit(message: string): { sha: string; message: string } {
  expect(message).toContain('[PROJ-123] fix:');
  expect(message).toContain('[ferry:iterator:');
  return { sha: 'def456', message };
}

interface AuditLine {
  ticket: string;
  iteration: number;
  cost_usd: number;
  run_id: string;
}

function mockAuditEmit(line: AuditLine): AuditLine {
  return line;
}

describe('iterate-happy E2E (dry-run, mocked side effects)', () => {
  it('threads the full Iterator pipeline and increments state.iteration', () => {
    process.env.FERRY_DRY_RUN = '1';
    const auditSpy = vi.fn(mockAuditEmit);

    const initialIteration = 1;
    const ticketKey = 'PROJ-123';
    const runId = '01HXYZ';

    // 0. Iteration cap should pass at iteration < 3
    expect(() =>
      checkIterationCap({ iteration: initialIteration, hasFindings: true }),
    ).not.toThrow();

    // 1. Build prompt from review history
    const prompt = buildIteratorPrompt({
      ticket_key: ticketKey,
      iteration_history: [
        { iteration: 0, pr_sha: 'aaa', fingerprints: ['fp1'] },
        { iteration: 1, pr_sha: 'bbb', fingerprints: ['fp1', 'fp2'] },
      ],
      latest_findings: [
        {
          rule_id: 'eslint/no-unused-vars',
          message: 'unused variable foo',
          file: 'src/foo.ts',
          line_start: 5,
          line_end: 5,
        },
      ],
      touch_paths: ['src/foo.ts'],
      branch_head_sha: 'ccc',
    });
    expect(prompt).toContain('Latest findings:');
    expect(prompt).toContain('eslint/no-unused-vars');

    // 2. Mocked LLM call
    const llm = mockLlmCall(prompt);
    expect(llm.diff).toContain('src/foo.ts');

    // 3. Mocked git apply
    const applied = mockGitApply(llm.diff);
    expect(applied.applied).toBe(true);
    expect(applied.changedPaths).toEqual(['src/foo.ts']);

    // 4. Format and commit
    const commitMessage = formatCommitMessage({
      ticket_key: ticketKey,
      summary: llm.summary,
      rule_ids: llm.rule_ids,
      run_id: runId,
    });
    const commit = mockGitCommit(commitMessage);
    expect(commit.sha).toBe('def456');

    // 5. Transition: pure decision
    const transition = decideIteratorTransition({ current_iteration: initialIteration });
    expect(transition.jira_status).toBe('In Review');
    expect(transition.add_labels).toContain('ferry:reviewing');
    expect(transition.remove_labels).toContain('ferry:iterating');
    expect(transition.next_phase).toBe('reviewing');
    expect(transition.next_iteration).toBe(initialIteration + 1);
    expect(transition.self_dispatch).toBe(false);

    // 6. Audit emission (orchestration-side, mocked here)
    auditSpy({
      ticket: ticketKey,
      iteration: transition.next_iteration,
      cost_usd: 0.0123,
      run_id: runId,
    });
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy.mock.calls[0]?.[0]).toMatchObject({
      ticket: ticketKey,
      iteration: 2,
      run_id: runId,
    });
  });
});
