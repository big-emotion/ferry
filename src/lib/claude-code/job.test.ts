import { describe, it, expect } from 'vitest';
import type { McpServerConfig } from '../llm/agent-loop/types.js';
import { buildClaudeCodeJob, CLAUDE_CODE_AUTH_INPUT, FORBIDDEN_AUTH_INPUT } from './job.js';
import { CC_OUTPUT_ARTIFACT_PATH } from './output-artifact.js';

describe('auth invariant (ADR-0006 §6 / decisions/0002 hard constraint)', () => {
  it('authenticates exclusively via claude_code_oauth_token, never anthropic_api_key', () => {
    expect(CLAUDE_CODE_AUTH_INPUT).toBe('claude_code_oauth_token');
    expect(FORBIDDEN_AUTH_INPUT).toBe('anthropic_api_key');
    const job = buildClaudeCodeJob({ role: 'developer', system: 's', initialPrompt: 'p' });
    expect(job.authInput).toBe('claude_code_oauth_token');
    expect(job.authInput).not.toBe(FORBIDDEN_AUTH_INPUT);
  });
});

describe('buildClaudeCodeJob', () => {
  it('folds the system prompt before the verbatim initial prompt + transport suffix', () => {
    const system = '# Developer\n\nDo the thing.';
    const initialPrompt = '<<<UNTRUSTED>>>\nTICKET: ABC-1\n<<<END>>>\nSUBTASKS: (none)';
    const job = buildClaudeCodeJob({ role: 'developer', system, initialPrompt });
    // The system prompt moved out of claude_args (#354) — it now leads the prompt.
    expect(job.prompt.startsWith(system)).toBe(true);
    // The initial prompt appears verbatim and contiguous, after the system prompt.
    const at = job.prompt.indexOf(initialPrompt);
    expect(at).toBeGreaterThan(system.length);
    expect(job.prompt.slice(at).startsWith(initialPrompt)).toBe(true);
    // The transport suffix is still appended after the initial prompt.
    expect(job.prompt).toContain(CC_OUTPUT_ARTIFACT_PATH);
  });

  it('exposes the artifact path and a role-bound fail-closed parser', () => {
    const job = buildClaudeCodeJob({ role: 'reviewer', system: 's', initialPrompt: 'p' });
    expect(job.outputArtifactPath).toBe(CC_OUTPUT_ARTIFACT_PATH);
    expect(job.parseOutput({ approved: true, comment: 'ok' })).toEqual({
      approved: true,
      comment: 'ok',
    });
    expect(() => job.parseOutput({ approved: 'nope' })).toThrow(/cc-output/i);
  });

  it('binds the parser to the role (developer → DonePayload)', () => {
    const job = buildClaudeCodeJob({ role: 'developer', system: 's', initialPrompt: 'p' });
    expect(job.parseOutput({ outcome: 'implemented', summary: 'done' })).toMatchObject({
      actionable: true,
      outcome: 'implemented',
    });
  });

  it('threads role/mcp/maxTurns/model into claude_args; system goes to the prompt', () => {
    const servers: McpServerConfig[] = [{ type: 'stdio', name: 'jira', command: 'run' }];
    const job = buildClaudeCodeJob({
      role: 'developer',
      system: 'SYS',
      initialPrompt: 'p',
      mcpServers: servers,
      maxTurns: 25,
      model: 'claude-opus-4-7',
    });
    // The system prompt is delivered via the prompt: input, never claude_args (#354).
    expect(job.claudeArgs).not.toContain('--append-system-prompt');
    expect(job.prompt.startsWith('SYS')).toBe(true);
    expect(job.claudeArgs).toContain('--mcp-config');
    expect(job.claudeArgs[job.claudeArgs.indexOf('--max-turns') + 1]).toBe('25');
    expect(job.claudeArgs[job.claudeArgs.indexOf('--model') + 1]).toBe('claude-opus-4-7');
  });

  it('reports the role read/write access for the parity table', () => {
    expect(buildClaudeCodeJob({ role: 'refiner', system: 's', initialPrompt: 'p' }).access).toBe(
      'read-only',
    );
    expect(buildClaudeCodeJob({ role: 'iterator', system: 's', initialPrompt: 'p' }).access).toBe(
      'read-write',
    );
  });

  it('fail-closed on an unknown role', () => {
    // @ts-expect-error intentional bad role
    expect(() => buildClaudeCodeJob({ role: 'x', system: 's', initialPrompt: 'p' })).toThrow(
      /unknown ferry role/i,
    );
  });
});
