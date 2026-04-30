import { StdioMcpClient } from './client.js';
import type { McpContent } from './client.js';
import type { AgentTool, StdioMcpServerConfig } from '../llm/agent-loop/types.js';

interface ToolRegistration {
  serverName: string;
  client: StdioMcpClient;
}

function renderContent(content: McpContent[]): string {
  return content
    .map((c) => {
      if (c.type === 'text') return c.text;
      if (c.type === 'image') return `[image/${c.mimeType}]`;
      return '[resource]';
    })
    .join('\n');
}

/**
 * Manages a pool of stdio MCP server connections.
 *
 * Call `connect()` to spawn and initialize the servers, `getTools()` to get
 * the merged tool list, `callTool()` to dispatch a tool call, and `close()` in
 * a finally block to terminate all spawned subprocesses.
 */
export class McpClientPool {
  private readonly clients = new Map<string, StdioMcpClient>();
  private readonly registry = new Map<string, ToolRegistration>();
  private readonly toolList: AgentTool[] = [];

  async connect(servers: StdioMcpServerConfig[]): Promise<void> {
    for (const server of servers) {
      const client = new StdioMcpClient(server.command, server.args ?? [], server.env);

      try {
        await client.initialize();
      } catch (err) {
        client.close();
        throw new Error(
          `Failed to initialize MCP server "${server.name}": ${(err as Error).message}`,
        );
      }

      this.clients.set(server.name, client);

      let tools;
      try {
        tools = await client.listTools();
      } catch (err) {
        client.close();
        this.clients.delete(server.name);
        throw new Error(
          `Failed to list tools from MCP server "${server.name}": ${(err as Error).message}`,
        );
      }

      for (const tool of tools) {
        if (server.allowed_tools?.length && !server.allowed_tools.includes(tool.name)) continue;
        if (server.denied_tools?.includes(tool.name)) continue;

        this.toolList.push({
          name: tool.name,
          description: tool.description ?? tool.name,
          input_schema: {
            type: 'object',
            properties: (tool.inputSchema.properties as Record<string, unknown>) ?? {},
            ...(tool.inputSchema.required?.length ? { required: tool.inputSchema.required } : {}),
          },
        });

        this.registry.set(tool.name, { serverName: server.name, client });
      }
    }
  }

  /** Returns all tools exposed by connected MCP servers (after allowlist filtering). */
  getTools(): AgentTool[] {
    return this.toolList.slice();
  }

  /** Returns true if the named tool is provided by any connected MCP server. */
  hasTool(name: string): boolean {
    return this.registry.has(name);
  }

  /** Returns the server name that provides the given tool, or undefined. */
  getServerName(toolName: string): string | undefined {
    return this.registry.get(toolName)?.serverName;
  }

  /** Dispatch a tool call to the appropriate MCP server and return the text result. */
  async callTool(name: string, input: Record<string, unknown>): Promise<string> {
    const reg = this.registry.get(name);
    if (!reg) throw new Error(`MCP tool not found in pool: ${name}`);

    const result = await reg.client.callTool(name, input);
    const text = renderContent(result.content ?? []);

    if (result.isError) {
      throw new Error(text || `MCP tool "${name}" returned an error`);
    }

    return text;
  }

  /** Terminate all spawned MCP server subprocesses. Safe to call multiple times. */
  async close(): Promise<void> {
    for (const client of this.clients.values()) {
      client.close();
    }
    this.clients.clear();
    this.registry.clear();
    this.toolList.length = 0;
  }
}
