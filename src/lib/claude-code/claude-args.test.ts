import { describe, it, expect } from 'vitest';
import type { McpServerConfig } from '../llm/agent-loop/types.js';
import { buildClaudeArgs } from './claude-args.js';

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
    expect(flagValue(args, '--allowedTools')).toBe('Bash,Read,Write,Edit,Glob,Grep');
  });

  it('builds the read-only native set for reviewer and refiner', () => {
    for (const role of ['reviewer', 'refiner'] as const) {
      expect(flagValue(buildClaudeArgs({ role, system: 's' }), '--allowedTools')).toBe(
        'Read,Glob,Grep',
      );
    }
  });

  it('appends MCP allowlist entries after the native tools', () => {
    const servers: McpServerConfig[] = [
      { type: 'stdio', name: 'jira', command: 'x', allowed_tools: ['get_issue'] },
      { name: 'context7', url: 'https://mcp.context7.com/mcp' },
    ];
    const args = buildClaudeArgs({ role: 'reviewer', system: 's', mcpServers: servers });
    expect(flagValue(args, '--allowedTools')).toBe(
      'Read,Glob,Grep,mcp__jira__get_issue,mcp__context7',
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
