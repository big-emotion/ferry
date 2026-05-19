import { describe, it, expect } from 'vitest';
import type {
  McpServerConfig,
  StdioMcpServerConfig,
  HttpMcpServerConfig,
} from '../llm/agent-loop/types.js';
import { toClaudeCodeMcpConfig, mcpToolAllowlist } from './mcp-config.js';

const stdio: StdioMcpServerConfig = {
  type: 'stdio',
  name: 'jira',
  command: 'npx',
  args: ['-y', '@ferry/jira-mcp'],
  env: { FERRY_JIRA_BASE_URL: 'https://x.atlassian.net' },
};

const http: HttpMcpServerConfig = {
  name: 'context7',
  url: 'https://mcp.context7.com/mcp',
};

const httpAuth: HttpMcpServerConfig = {
  name: 'secure',
  url: 'https://mcp.example.com/mcp',
  authorization_token: 'tok-123',
};

describe('toClaudeCodeMcpConfig', () => {
  it('wraps servers under an mcpServers object keyed by server name', () => {
    const cfg = toClaudeCodeMcpConfig([stdio, http]);
    expect(Object.keys(cfg.mcpServers)).toEqual(['jira', 'context7']);
  });

  it('maps a stdio server to command/args/env (type stdio)', () => {
    const cfg = toClaudeCodeMcpConfig([stdio]);
    expect(cfg.mcpServers.jira).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@ferry/jira-mcp'],
      env: { FERRY_JIRA_BASE_URL: 'https://x.atlassian.net' },
    });
  });

  it('omits empty args/env for a minimal stdio server', () => {
    const minimal: StdioMcpServerConfig = { type: 'stdio', name: 's', command: 'run' };
    const cfg = toClaudeCodeMcpConfig([minimal]);
    expect(cfg.mcpServers.s).toEqual({ type: 'stdio', command: 'run' });
  });

  it('maps an http server to a remote http url', () => {
    const cfg = toClaudeCodeMcpConfig([http]);
    expect(cfg.mcpServers.context7).toEqual({
      type: 'http',
      url: 'https://mcp.context7.com/mcp',
    });
  });

  it('maps an http authorization_token to an Authorization Bearer header', () => {
    const cfg = toClaudeCodeMcpConfig([httpAuth]);
    expect(cfg.mcpServers.secure).toEqual({
      type: 'http',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer tok-123' },
    });
  });

  it('returns an empty mcpServers object for no servers', () => {
    expect(toClaudeCodeMcpConfig([])).toEqual({ mcpServers: {} });
  });

  it('throws on a duplicate server name (fail-closed)', () => {
    expect(() => toClaudeCodeMcpConfig([stdio, { ...stdio }])).toThrow(/duplicate mcp server/i);
  });
});

describe('mcpToolAllowlist', () => {
  it('emits a server-wide wildcard when no per-server allowlist is set', () => {
    expect(mcpToolAllowlist([stdio, http])).toEqual(['mcp__jira', 'mcp__context7']);
  });

  it('emits per-tool entries when allowed_tools is set on a server', () => {
    const scoped: McpServerConfig = { ...stdio, allowed_tools: ['get_issue', 'search'] };
    expect(mcpToolAllowlist([scoped])).toEqual(['mcp__jira__get_issue', 'mcp__jira__search']);
  });

  it('falls back to the wildcard when allowed_tools is present but empty', () => {
    const scoped: McpServerConfig = { ...stdio, allowed_tools: [] };
    expect(mcpToolAllowlist([scoped])).toEqual(['mcp__jira']);
  });

  it('returns an empty list for no servers', () => {
    expect(mcpToolAllowlist([])).toEqual([]);
  });

  it('excludes denied tools from a per-tool allowed_tools list (parity with pool.ts)', () => {
    const scoped: McpServerConfig = {
      ...stdio,
      allowed_tools: ['get_issue', 'search', 'delete_issue'],
      denied_tools: ['delete_issue'],
    };
    expect(mcpToolAllowlist([scoped])).toEqual(['mcp__jira__get_issue', 'mcp__jira__search']);
  });

  it('drops a server entirely when denied_tools removes every allowed tool', () => {
    const scoped: McpServerConfig = {
      ...stdio,
      allowed_tools: ['delete_issue'],
      denied_tools: ['delete_issue'],
    };
    expect(mcpToolAllowlist([scoped])).toEqual([]);
  });

  it('fails closed when denied_tools is set without allowed_tools (stdio)', () => {
    const scoped: McpServerConfig = { ...stdio, denied_tools: ['delete_issue'] };
    expect(() => mcpToolAllowlist([scoped])).toThrow(
      /denied_tools without allowed_tools.*failing closed/is,
    );
  });

  it('fails closed when denied_tools is set without allowed_tools (http)', () => {
    const scoped: McpServerConfig = { ...http, denied_tools: ['danger'] };
    expect(() => mcpToolAllowlist([scoped])).toThrow(/denied_tools without allowed_tools/i);
  });

  it('treats an empty denied_tools as no deny and keeps the wildcard', () => {
    const scoped: McpServerConfig = { ...stdio, denied_tools: [] };
    expect(mcpToolAllowlist([scoped])).toEqual(['mcp__jira']);
  });
});
