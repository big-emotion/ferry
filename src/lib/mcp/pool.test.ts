import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StdioMcpServerConfig } from '../llm/agent-loop/types.js';

// Hoisted mock — must come before the import of McpClientPool
vi.mock('./client.js', () => {
  return {
    StdioMcpClient: vi.fn(),
  };
});

import { McpClientPool } from './pool.js';
import { StdioMcpClient } from './client.js';

type ClientMock = {
  initialize: ReturnType<typeof vi.fn>;
  listTools: ReturnType<typeof vi.fn>;
  callTool: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

function makeClientMock(
  tools: Array<{
    name: string;
    description?: string;
    inputSchema: { properties?: Record<string, unknown>; required?: string[] };
  }> = [],
  callResult: { content: Array<{ type: string; text?: string; mimeType?: string }>; isError?: boolean } = {
    content: [{ type: 'text', text: 'ok' }],
  },
): ClientMock {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue(tools),
    callTool: vi.fn().mockResolvedValue(callResult),
    close: vi.fn(),
  };
}

const stdioServer: StdioMcpServerConfig = {
  type: 'stdio',
  name: 'test-server',
  command: 'npx',
  args: ['-y', 'test-mcp-server'],
};

describe('McpClientPool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty tool list when no servers connected', async () => {
    const pool = new McpClientPool();
    expect(pool.getTools()).toEqual([]);
    expect(pool.hasTool('anything')).toBe(false);
  });

  it('connects to stdio servers and exposes their tools', async () => {
    const tools = [
      {
        name: 'read_resource',
        description: 'Read a resource',
        inputSchema: { properties: { uri: { type: 'string' } }, required: ['uri'] },
      },
      {
        name: 'write_resource',
        description: 'Write a resource',
        inputSchema: {
          properties: { uri: { type: 'string' }, content: { type: 'string' } },
          required: ['uri', 'content'],
        },
      },
    ];

    vi.mocked(StdioMcpClient).mockImplementation(() => makeClientMock(tools) as unknown as InstanceType<typeof StdioMcpClient>);

    const pool = new McpClientPool();
    await pool.connect([stdioServer]);

    expect(pool.getTools()).toHaveLength(2);
    expect(pool.getTools()[0]).toMatchObject({
      name: 'read_resource',
      description: 'Read a resource',
      input_schema: {
        type: 'object',
        properties: { uri: { type: 'string' } },
        required: ['uri'],
      },
    });
    expect(pool.hasTool('read_resource')).toBe(true);
    expect(pool.hasTool('nonexistent')).toBe(false);
  });

  it('applies allowed_tools filter', async () => {
    const tools = [
      { name: 'tool_a', inputSchema: {} },
      { name: 'tool_b', inputSchema: {} },
      { name: 'tool_c', inputSchema: {} },
    ];

    vi.mocked(StdioMcpClient).mockImplementation(() => makeClientMock(tools) as unknown as InstanceType<typeof StdioMcpClient>);

    const pool = new McpClientPool();
    await pool.connect([{ ...stdioServer, allowed_tools: ['tool_a', 'tool_c'] }]);

    expect(pool.getTools().map((t) => t.name)).toEqual(['tool_a', 'tool_c']);
    expect(pool.hasTool('tool_b')).toBe(false);
  });

  it('applies denied_tools filter', async () => {
    const tools = [
      { name: 'tool_a', inputSchema: {} },
      { name: 'tool_b', inputSchema: {} },
    ];

    vi.mocked(StdioMcpClient).mockImplementation(() => makeClientMock(tools) as unknown as InstanceType<typeof StdioMcpClient>);

    const pool = new McpClientPool();
    await pool.connect([{ ...stdioServer, denied_tools: ['tool_b'] }]);

    expect(pool.getTools().map((t) => t.name)).toEqual(['tool_a']);
  });

  it('dispatches tool calls and returns text content', async () => {
    const tools = [{ name: 'greet', inputSchema: { properties: { name: { type: 'string' } } } }];
    const clientMock = makeClientMock(tools, {
      content: [{ type: 'text', text: 'Hello, world!' }],
    });

    vi.mocked(StdioMcpClient).mockImplementation(() => clientMock as unknown as InstanceType<typeof StdioMcpClient>);

    const pool = new McpClientPool();
    await pool.connect([stdioServer]);

    const result = await pool.callTool('greet', { name: 'world' });
    expect(result).toBe('Hello, world!');
    expect(clientMock.callTool).toHaveBeenCalledWith('greet', { name: 'world' });
  });

  it('throws for unknown tool names', async () => {
    const pool = new McpClientPool();
    await pool.connect([]);
    await expect(pool.callTool('unknown', {})).rejects.toThrow('MCP tool not found in pool: unknown');
  });

  it('throws when tool returns isError: true', async () => {
    const tools = [{ name: 'fail_tool', inputSchema: {} }];
    const clientMock = makeClientMock(tools, {
      content: [{ type: 'text', text: 'Permission denied' }],
      isError: true,
    });

    vi.mocked(StdioMcpClient).mockImplementation(() => clientMock as unknown as InstanceType<typeof StdioMcpClient>);

    const pool = new McpClientPool();
    await pool.connect([stdioServer]);

    await expect(pool.callTool('fail_tool', {})).rejects.toThrow('Permission denied');
  });

  it('closes all clients when close() is called', async () => {
    const clientMock = makeClientMock([{ name: 'tool_x', inputSchema: {} }]);
    vi.mocked(StdioMcpClient).mockImplementation(() => clientMock as unknown as InstanceType<typeof StdioMcpClient>);

    const pool = new McpClientPool();
    await pool.connect([stdioServer]);
    await pool.close();

    expect(clientMock.close).toHaveBeenCalled();
    expect(pool.getTools()).toHaveLength(0);
    expect(pool.hasTool('tool_x')).toBe(false);
  });

  it('merges tools from multiple servers', async () => {
    let callCount = 0;
    vi.mocked(StdioMcpClient).mockImplementation(() => {
      const toolName = callCount === 0 ? 'server1_tool' : 'server2_tool';
      callCount++;
      return makeClientMock([{ name: toolName, inputSchema: {} }]) as unknown as InstanceType<typeof StdioMcpClient>;
    });

    const server2: StdioMcpServerConfig = {
      type: 'stdio',
      name: 'server2',
      command: 'npx',
      args: ['server2'],
    };

    const pool = new McpClientPool();
    await pool.connect([stdioServer, server2]);

    expect(pool.getTools()).toHaveLength(2);
    expect(pool.hasTool('server1_tool')).toBe(true);
    expect(pool.hasTool('server2_tool')).toBe(true);
    expect(pool.getServerName('server1_tool')).toBe('test-server');
    expect(pool.getServerName('server2_tool')).toBe('server2');
  });

  it('renders image content as placeholder', async () => {
    const tools = [{ name: 'screenshot', inputSchema: {} }];
    const clientMock = makeClientMock(tools, {
      content: [{ type: 'image', mimeType: 'image/png' }],
    });

    vi.mocked(StdioMcpClient).mockImplementation(() => clientMock as unknown as InstanceType<typeof StdioMcpClient>);

    const pool = new McpClientPool();
    await pool.connect([stdioServer]);

    const result = await pool.callTool('screenshot', {});
    expect(result).toBe('[image/image/png]');
  });

  it('throws and cleans up client when initialize fails', async () => {
    const clientMock = {
      initialize: vi.fn().mockRejectedValue(new Error('spawn failed')),
      listTools: vi.fn(),
      callTool: vi.fn(),
      close: vi.fn(),
    };

    vi.mocked(StdioMcpClient).mockImplementation(() => clientMock as unknown as InstanceType<typeof StdioMcpClient>);

    const pool = new McpClientPool();
    await expect(pool.connect([stdioServer])).rejects.toThrow(
      'Failed to initialize MCP server "test-server": spawn failed',
    );
    expect(clientMock.close).toHaveBeenCalled();
  });

  it('does not connect when empty server list is given', async () => {
    const pool = new McpClientPool();
    await pool.connect([]);
    expect(pool.getTools()).toHaveLength(0);
    expect(vi.mocked(StdioMcpClient)).not.toHaveBeenCalled();
  });
});
