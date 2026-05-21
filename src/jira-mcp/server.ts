/**
 * Assembles the `ferry-jira-mcp` stdio MCP server from injected dependencies.
 *
 * Uses the low-level `Server` class (plain JSON Schema tool definitions) so the
 * package carries no Zod usage of its own — the only new dependency is
 * `@modelcontextprotocol/sdk` itself.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { JIRA_MCP_TOOLS, dispatchTool, type JiraMcpDeps } from './tools.js';

/** Server name + version advertised to MCP clients. */
export const JIRA_MCP_SERVER_INFO = { name: 'ferry-jira-mcp', version: '0.14.0' } as const;

/** Builds a configured (but not yet connected) MCP server. */
export function createJiraMcpServer(deps: JiraMcpDeps): Server {
  const server = new Server(JIRA_MCP_SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: JIRA_MCP_TOOLS }));

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request): Promise<CallToolResult> =>
      dispatchTool(request.params.name, request.params.arguments, deps),
  );

  return server;
}
