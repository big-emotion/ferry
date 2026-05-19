/**
 * Translates Ferry's internal MCP server configs into the shape
 * `claude-code-action` expects via `claude_args --mcp-config`, and derives the
 * matching `mcp__<server>[__<tool>]` allowlist entries.
 *
 * Capability filtering (ticket-label → enabled servers / per-server tool
 * allowlists) is NOT done here — callers run the existing
 * `filterMcpServers()` (src/lib/labels/capabilities.ts) first and pass the
 * already-filtered pool in. This module is a pure shape translator so it stays
 * trivially unit-testable and the parity logic has a single home.
 */

import type {
  McpServerConfig,
  StdioMcpServerConfig,
  HttpMcpServerConfig,
} from '../llm/agent-loop/types.js';
import { isStdioMcpServer } from '../llm/agent-loop/types.js';

interface ClaudeCodeStdioServer {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface ClaudeCodeHttpServer {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export type ClaudeCodeMcpServer = ClaudeCodeStdioServer | ClaudeCodeHttpServer;

export interface ClaudeCodeMcpConfig {
  mcpServers: Record<string, ClaudeCodeMcpServer>;
}

function mapStdio(s: StdioMcpServerConfig): ClaudeCodeStdioServer {
  const out: ClaudeCodeStdioServer = { type: 'stdio', command: s.command };
  if (s.args && s.args.length > 0) out.args = [...s.args];
  if (s.env && Object.keys(s.env).length > 0) out.env = { ...s.env };
  return out;
}

function mapHttp(s: HttpMcpServerConfig): ClaudeCodeHttpServer {
  const out: ClaudeCodeHttpServer = { type: 'http', url: s.url };
  if (s.authorization_token) {
    out.headers = { Authorization: `Bearer ${s.authorization_token}` };
  }
  return out;
}

/**
 * Builds the `{ mcpServers: { <name>: <server> } }` object for
 * `--mcp-config`. Throws on a duplicate server name (fail-closed: a silent
 * last-wins merge could drop a security-relevant server).
 */
export function toClaudeCodeMcpConfig(servers: McpServerConfig[]): ClaudeCodeMcpConfig {
  const mcpServers: Record<string, ClaudeCodeMcpServer> = {};
  for (const s of servers) {
    if (Object.prototype.hasOwnProperty.call(mcpServers, s.name)) {
      throw new Error(`duplicate mcp server name: ${s.name}`);
    }
    mcpServers[s.name] = isStdioMcpServer(s) ? mapStdio(s) : mapHttp(s);
  }
  return { mcpServers };
}

/**
 * Derives the MCP entries for `--allowedTools`.
 *
 * `claude-code-action`'s `--allowedTools` is allow-only and matches by prefix
 * (`mcp__<server>` allows every tool of that server; `mcp__<server>__<tool>`
 * allows exactly one). It has no "deny" form and no enumeration of a server's
 * live tool list at this layer, so "all tools except the denied set" is not
 * directly expressible from a bare wildcard.
 *
 * To keep parity with the bundled path — which enforces `denied_tools`
 * (`src/lib/llm/agent-loop/anthropic.ts` emits it into `mcp_toolset`;
 * `src/lib/mcp/pool.ts` filters it out of the local stdio tool list) — this
 * function honors `denied_tools`:
 *
 * - non-empty `allowed_tools`: emit one `mcp__<server>__<tool>` per tool, but
 *   exclude any tool also present in `denied_tools` (mirrors pool.ts ordering:
 *   allow-list intersect, then deny-list subtract);
 * - no `allowed_tools` but a non-empty `denied_tools`: a `mcp__<server>`
 *   wildcard would silently re-allow the denied tools and there is no tool
 *   list to enumerate the complement from — fail closed by throwing rather
 *   than silently widening the agent's MCP allowlist;
 * - otherwise: a single `mcp__<server>` wildcard allowing all of that
 *   server's tools.
 */
export function mcpToolAllowlist(servers: McpServerConfig[]): string[] {
  const allow: string[] = [];
  for (const s of servers) {
    const denied = new Set(s.denied_tools ?? []);
    if (s.allowed_tools && s.allowed_tools.length > 0) {
      for (const tool of s.allowed_tools) {
        if (denied.has(tool)) continue;
        allow.push(`mcp__${s.name}__${tool}`);
      }
    } else if (denied.size > 0) {
      throw new Error(
        `mcp server "${s.name}" sets denied_tools without allowed_tools: ` +
          `claude-code-action --allowedTools cannot express a deny-only allowlist ` +
          `(failing closed to avoid silently re-allowing denied tools)`,
      );
    } else {
      allow.push(`mcp__${s.name}`);
    }
  }
  return allow;
}
