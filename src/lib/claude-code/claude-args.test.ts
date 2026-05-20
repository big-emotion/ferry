import { describe, it, expect } from 'vitest';
import type { McpServerConfig } from '../llm/agent-loop/types.js';
import { buildClaudeArgs } from './claude-args.js';
import { NO_AUTO_MERGE_DENY } from './tool-policy.js';
import type { FerryRole } from './tool-profiles.js';

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

describe('buildClaudeArgs', () => {
  it('passes the system prompt verbatim via --append-system-prompt', () => {
    const sys = 'You are the Ferry Developer.\n\nLine two.';
    const args = buildClaudeArgs({ role: 'developer', system: sys });
    expect(flagValue(args, '--append-system-prompt')).toBe(sys);
  });

  it('builds --allowedTools from the role native set (read-write for developer)', () => {
    const args = buildClaudeArgs({ role: 'developer', system: 's' });
    expect(flagValue(args, '--allowedTools')).toBe(
      'Bash,Read,Write,Edit,Glob,Grep,Write(.ferry/cc-output.json)',
    );
  });

  it('builds the read-only native set for reviewer and refiner with narrow artifact Write grant', () => {
    for (const role of ['reviewer', 'refiner'] as const) {
      expect(flagValue(buildClaudeArgs({ role, system: 's' }), '--allowedTools')).toBe(
        'Read,Glob,Grep,Write(.ferry/cc-output.json)',
      );
    }
  });

  it('narrow Write(.ferry/cc-output.json) grant is present for every role', () => {
    const ROLES: FerryRole[] = ['refiner', 'developer', 'reviewer', 'iterator'];
    for (const role of ROLES) {
      const allowed = flagValue(buildClaudeArgs({ role, system: 's' }), '--allowedTools') ?? '';
      expect(allowed).toContain('Write(.ferry/cc-output.json)');
    }
  });

  it('appends MCP allowlist entries after the native tools', () => {
    const servers: McpServerConfig[] = [
      { type: 'stdio', name: 'jira', command: 'x', allowed_tools: ['get_issue'] },
      { name: 'context7', url: 'https://mcp.context7.com/mcp' },
    ];
    const args = buildClaudeArgs({ role: 'reviewer', system: 's', mcpServers: servers });
    expect(flagValue(args, '--allowedTools')).toBe(
      'Read,Glob,Grep,Write(.ferry/cc-output.json),mcp__jira__get_issue,mcp__context7',
    );
  });

  it('emits --mcp-config as compact JSON only when servers are present', () => {
    const none = buildClaudeArgs({ role: 'developer', system: 's' });
    expect(none).not.toContain('--mcp-config');

    const servers: McpServerConfig[] = [{ type: 'stdio', name: 'jira', command: 'run' }];
    const args = buildClaudeArgs({ role: 'developer', system: 's', mcpServers: servers });
    expect(JSON.parse(flagValue(args, '--mcp-config') as string)).toEqual({
      mcpServers: { jira: { type: 'stdio', command: 'run' } },
    });
  });

  it('adds --max-turns and --model only when provided', () => {
    const bare = buildClaudeArgs({ role: 'developer', system: 's' });
    expect(bare).not.toContain('--max-turns');
    expect(bare).not.toContain('--model');

    const full = buildClaudeArgs({
      role: 'developer',
      system: 's',
      maxTurns: 40,
      model: 'claude-opus-4-7',
    });
    expect(flagValue(full, '--max-turns')).toBe('40');
    expect(flagValue(full, '--model')).toBe('claude-opus-4-7');
  });

  it('rejects a non-positive max-turns (fail-closed)', () => {
    expect(() => buildClaudeArgs({ role: 'developer', system: 's', maxTurns: 0 })).toThrow(
      /max-turns/i,
    );
  });
});

describe('buildClaudeArgs — no-auto-merge hardening (ADR-0002 §D, #303)', () => {
  const ROLES: FerryRole[] = ['refiner', 'developer', 'reviewer', 'iterator'];

  it.each(ROLES)('every role emits --disallowedTools: %s', (role) => {
    const args = buildClaudeArgs({ role, system: 's' });
    expect(args).toContain('--disallowedTools');
    const disallowed = flagValue(args, '--disallowedTools') ?? '';
    const rules = disallowed.split(',');
    for (const rule of NO_AUTO_MERGE_DENY) {
      expect(rules).toContain(rule);
    }
  });

  it('--disallowedTools always denies git push (bare and prefixed)', () => {
    const args = buildClaudeArgs({ role: 'developer', system: 's' });
    const disallowed = flagValue(args, '--disallowedTools') ?? '';
    expect(disallowed).toContain('Bash(git push)');
    expect(disallowed).toContain('Bash(git push:*)');
  });

  it('--disallowedTools always denies gh pr merge (bare and prefixed)', () => {
    const args = buildClaudeArgs({ role: 'developer', system: 's' });
    const disallowed = flagValue(args, '--disallowedTools') ?? '';
    expect(disallowed).toContain('Bash(gh pr merge)');
    expect(disallowed).toContain('Bash(gh pr merge:*)');
  });

  it('--disallowedTools is present even with MCP servers in the allowlist', () => {
    const servers: McpServerConfig[] = [
      { type: 'stdio', name: 'jira', command: 'x', allowed_tools: ['get_issue'] },
    ];
    const args = buildClaudeArgs({ role: 'developer', system: 's', mcpServers: servers });
    const disallowed = flagValue(args, '--disallowedTools') ?? '';
    expect(disallowed).toContain('Bash(git push:*)');
  });

  it('--allowedTools and --disallowedTools both appear (deny is always additive)', () => {
    const args = buildClaudeArgs({ role: 'developer', system: 's' });
    expect(args).toContain('--allowedTools');
    expect(args).toContain('--disallowedTools');
    const allowed = flagValue(args, '--allowedTools') ?? '';
    const disallowed = flagValue(args, '--disallowedTools') ?? '';
    // No rule in the deny set may appear in the allow set — tested here end-to-end.
    for (const rule of NO_AUTO_MERGE_DENY) {
      expect(allowed).not.toContain(rule);
      expect(disallowed).toContain(rule);
    }
  });
});
