import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { FerryError } from '../../errors/index.js';
import { createAnthropicAgentLoop } from './anthropic.js';
import { createTestLogger } from '../../logger/index.js';
import type { McpServerConfig } from './types.js';

// Hoisted so the factory can close over them before module imports resolve.
const { mockPool, MockMcpClientPool } = vi.hoisted(() => {
  const pool = {
    connect: vi.fn().mockResolvedValue(undefined),
    getTools: vi.fn().mockReturnValue([]),
    hasTool: vi.fn().mockReturnValue(false),
    getServerName: vi.fn().mockReturnValue(undefined),
    callTool: vi.fn().mockResolvedValue('mcp result'),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const ctor = vi.fn().mockImplementation(function () {
    return pool;
  });
  return { mockPool: pool, MockMcpClientPool: ctor };
});

vi.mock('../../mcp/pool.js', () => ({
  McpClientPool: MockMcpClientPool,
}));

type FakeResponse = {
  stop_reason: string;
  content: Array<{
    type: string;
    id?: string;
    name?: string;
    input?: unknown;
    text?: string;
    server_name?: string;
  }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
};

function makeMock(regularResponses: FakeResponse[], betaResponses?: FakeResponse[]) {
  let regIdx = 0;
  let betaIdx = 0;
  const regularCreate = vi.fn().mockImplementation(async () => {
    const r = regularResponses[regIdx++];
    return {
      stop_reason: r.stop_reason,
      content: r.content,
      usage: r.usage ?? { input_tokens: 10, output_tokens: 5 },
    };
  });
  const betaCreate = vi.fn().mockImplementation(async () => {
    const src = betaResponses ?? regularResponses;
    const r = src[betaIdx++];
    return {
      stop_reason: r.stop_reason,
      content: r.content,
      usage: r.usage ?? { input_tokens: 10, output_tokens: 5 },
    };
  });
  return {
    messages: { create: regularCreate },
    beta: { messages: { create: betaCreate } },
    regularCreate,
    betaCreate,
  };
}

const doneResponse: FakeResponse = {
  stop_reason: 'tool_use',
  content: [
    {
      type: 'tool_use',
      id: 'tu_done',
      name: 'done',
      input: { actionable: true, summary: 'done' },
    },
  ],
};

const noopExecuteTool =
  vi.fn<(r: string, n: string, i: Record<string, unknown>) => Promise<string>>();

const baseInput = {
  system: 's',
  initialPrompt: 'p',
  tools: [],
  repoRoot: '/r',
  branchName: 'ferry/TEST-1',
  secretScan: async () => {},
};

function restorePoolDefaults(): void {
  MockMcpClientPool.mockImplementation(function () {
    return mockPool;
  });
  mockPool.connect.mockResolvedValue(undefined);
  mockPool.getTools.mockReturnValue([]);
  mockPool.hasTool.mockReturnValue(false);
  mockPool.getServerName.mockReturnValue(undefined);
  mockPool.callTool.mockResolvedValue('mcp result');
  mockPool.close.mockResolvedValue(undefined);
}

describe('createAnthropicAgentLoop — MCP connector', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // vi.resetAllMocks() wipes pool implementations — restore sensible defaults.
    restorePoolDefaults();
  });

  it('uses regular messages.create when mcpServers is empty (regression)', async () => {
    const mock = makeMock([doneResponse]);
    const loop = createAnthropicAgentLoop({
      model: 'm',
      client: mock as unknown as Anthropic,
      executeTool: noopExecuteTool,
    });

    await loop.run({ ...baseInput, mcpServers: [] });

    expect(mock.regularCreate).toHaveBeenCalledOnce();
    expect(mock.betaCreate).not.toHaveBeenCalled();
  });

  it('uses regular messages.create when mcpServers is absent (regression)', async () => {
    const mock = makeMock([doneResponse]);
    const loop = createAnthropicAgentLoop({
      model: 'm',
      client: mock as unknown as Anthropic,
      executeTool: noopExecuteTool,
    });

    await loop.run(baseInput);

    expect(mock.regularCreate).toHaveBeenCalledOnce();
    expect(mock.betaCreate).not.toHaveBeenCalled();
  });

  it('uses beta.messages.create when mcpServers is non-empty', async () => {
    const mock = makeMock([], [doneResponse]);
    const loop = createAnthropicAgentLoop({
      model: 'm',
      client: mock as unknown as Anthropic,
      executeTool: noopExecuteTool,
    });

    const server: McpServerConfig = { name: 'context7', url: 'https://mcp.context7.com/mcp' };
    await loop.run({ ...baseInput, mcpServers: [server] });

    expect(mock.regularCreate).not.toHaveBeenCalled();
    expect(mock.betaCreate).toHaveBeenCalledOnce();
  });

  it('sends betas header and mcp_servers when mcpServers is non-empty', async () => {
    const mock = makeMock([], [doneResponse]);
    const loop = createAnthropicAgentLoop({
      model: 'm',
      client: mock as unknown as Anthropic,
      executeTool: noopExecuteTool,
    });

    const server: McpServerConfig = {
      name: 'context7',
      url: 'https://mcp.context7.com/mcp',
      authorization_token: 'tok-123',
    };
    await loop.run({ ...baseInput, mcpServers: [server] });

    expect(mock.betaCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        betas: ['mcp-client-2025-11-20'],
        mcp_servers: [
          {
            type: 'url',
            name: 'context7',
            url: 'https://mcp.context7.com/mcp',
            authorization_token: 'tok-123',
          },
        ],
      }),
    );
  });

  it('includes mcp_toolset in tools with allowlist', async () => {
    const mock = makeMock([], [doneResponse]);
    const loop = createAnthropicAgentLoop({
      model: 'm',
      client: mock as unknown as Anthropic,
      executeTool: noopExecuteTool,
    });

    const server: McpServerConfig = {
      name: 'context7',
      url: 'https://mcp.context7.com/mcp',
      allowed_tools: ['resolve-library-id', 'get-library-docs'],
    };
    await loop.run({ ...baseInput, mcpServers: [server] });

    const callArgs = mock.betaCreate.mock.calls[0][0] as { tools: unknown[] };
    expect(callArgs.tools).toContainEqual(
      expect.objectContaining({
        type: 'mcp_toolset',
        mcp_server_name: 'context7',
        allowed_tools: ['resolve-library-id', 'get-library-docs'],
      }),
    );
  });

  it('includes mcp_toolset in tools with denylist', async () => {
    const mock = makeMock([], [doneResponse]);
    const loop = createAnthropicAgentLoop({
      model: 'm',
      client: mock as unknown as Anthropic,
      executeTool: noopExecuteTool,
    });

    const server: McpServerConfig = {
      name: 'github',
      url: 'https://api.githubcopilot.com/mcp',
      denied_tools: ['create_issue', 'delete_branch'],
    };
    await loop.run({ ...baseInput, mcpServers: [server] });

    const callArgs = mock.betaCreate.mock.calls[0][0] as { tools: unknown[] };
    expect(callArgs.tools).toContainEqual(
      expect.objectContaining({
        type: 'mcp_toolset',
        mcp_server_name: 'github',
        denied_tools: ['create_issue', 'delete_branch'],
      }),
    );
  });

  it('does not include allowed_tools or denied_tools when neither is set', async () => {
    const mock = makeMock([], [doneResponse]);
    const loop = createAnthropicAgentLoop({
      model: 'm',
      client: mock as unknown as Anthropic,
      executeTool: noopExecuteTool,
    });

    const server: McpServerConfig = { name: 'context7', url: 'https://mcp.context7.com/mcp' };
    await loop.run({ ...baseInput, mcpServers: [server] });

    const callArgs = mock.betaCreate.mock.calls[0][0] as { tools: unknown[] };
    const toolset = callArgs.tools.find(
      (t) => (t as { type: string }).type === 'mcp_toolset',
    ) as Record<string, unknown>;
    expect(toolset).not.toHaveProperty('allowed_tools');
    expect(toolset).not.toHaveProperty('denied_tools');
  });

  it('logs mcp_tool_use blocks but does not execute them locally', async () => {
    const mcpToolUseResponse: FakeResponse = {
      stop_reason: 'tool_use',
      content: [
        { type: 'mcp_tool_use', id: 'mcp_1', name: 'get-library-docs', server_name: 'context7' },
        {
          type: 'tool_use',
          id: 'tu_done',
          name: 'done',
          input: { actionable: true, summary: 'ok' },
        },
      ],
    };

    const mock = makeMock([], [mcpToolUseResponse]);
    const execTool = vi.fn<(r: string, n: string, i: Record<string, unknown>) => Promise<string>>();
    const loop = createAnthropicAgentLoop({
      model: 'm',
      client: mock as unknown as Anthropic,
      executeTool: execTool,
    });

    const server: McpServerConfig = { name: 'context7', url: 'https://mcp.context7.com/mcp' };
    const result = await loop.run({ ...baseInput, mcpServers: [server] });

    // mcp_tool_use should not be passed to executeTool
    expect(execTool).not.toHaveBeenCalled();
    // But the loop should still complete via the done tool_use block
    expect(result.done.actionable).toBe(true);
  });

  it('accumulates usage including iterations with mcp_tool_use blocks', async () => {
    const firstResponse: FakeResponse = {
      stop_reason: 'tool_use',
      content: [
        { type: 'mcp_tool_use', id: 'mcp_1', name: 'search', server_name: 'context7' },
        { type: 'tool_use', id: 'tu_read', name: 'read_file', input: { path: 'x.ts' } },
      ],
      usage: { input_tokens: 100, output_tokens: 40 },
    };

    const execTool = vi
      .fn<(r: string, n: string, i: Record<string, unknown>) => Promise<string>>()
      .mockResolvedValueOnce('file content');

    const mock = makeMock(
      [],
      [firstResponse, { ...doneResponse, usage: { input_tokens: 80, output_tokens: 20 } }],
    );
    const loop = createAnthropicAgentLoop({
      model: 'm',
      client: mock as unknown as Anthropic,
      executeTool: execTool,
    });

    const server: McpServerConfig = { name: 'context7', url: 'https://mcp.context7.com/mcp' };
    const result = await loop.run({ ...baseInput, mcpServers: [server] });

    expect(result.usage.input_tokens).toBe(180);
    expect(result.usage.output_tokens).toBe(60);
    expect(result.iterations).toBe(2);
  });

  it('throws FerryError when stop_reason is end_turn (malformed server response)', async () => {
    const malformedResponse: FakeResponse = {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'I am done.' }],
    };

    const mock = makeMock([], [malformedResponse]);
    const loop = createAnthropicAgentLoop({
      model: 'm',
      client: mock as unknown as Anthropic,
      executeTool: noopExecuteTool,
    });

    const server: McpServerConfig = { name: 'context7', url: 'https://mcp.context7.com/mcp' };
    await expect(loop.run({ ...baseInput, mcpServers: [server] })).rejects.toThrow(FerryError);
  });
});

// ---------------------------------------------------------------------------
// Stdio MCP client-side tools
// ---------------------------------------------------------------------------

describe('createAnthropicAgentLoop — stdio MCP tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restorePoolDefaults();
  });

  it('uses regular messages.create (not beta) for stdio-only servers', async () => {
    const mock = makeMock([doneResponse]);
    const loop = createAnthropicAgentLoop({
      model: 'm',
      client: mock as unknown as Anthropic,
      executeTool: noopExecuteTool,
    });

    const stdioServer: McpServerConfig = {
      type: 'stdio',
      name: 'fs',
      command: 'node',
      args: ['mcp-server.js'],
    };

    await loop.run({ ...baseInput, mcpServers: [stdioServer] });

    expect(mock.regularCreate).toHaveBeenCalledOnce();
    expect(mock.betaCreate).not.toHaveBeenCalled();
    expect(mockPool.connect).toHaveBeenCalledWith([stdioServer]);
  });

  it('includes stdio MCP tools in the tools array passed to API', async () => {
    const mcpTool = {
      name: 'list_files',
      description: 'List files in a directory',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    };
    mockPool.getTools.mockReturnValue([mcpTool]);
    mockPool.hasTool.mockImplementation((name: string) => name === 'list_files');

    const mock = makeMock([doneResponse]);
    const loop = createAnthropicAgentLoop({
      model: 'm',
      client: mock as unknown as Anthropic,
      executeTool: noopExecuteTool,
    });

    const stdioServer: McpServerConfig = { type: 'stdio', name: 'fs', command: 'node', args: [] };
    await loop.run({ ...baseInput, mcpServers: [stdioServer] });

    const callArgs = mock.regularCreate.mock.calls[0][0] as { tools: unknown[] };
    expect(callArgs.tools).toContainEqual(expect.objectContaining({ name: 'list_files' }));
  });

  it('dispatches stdio MCP tool calls to the pool', async () => {
    mockPool.getTools.mockReturnValue([
      {
        name: 'read_resource',
        description: 'Read',
        input_schema: { type: 'object', properties: {}, required: [] },
      },
    ]);
    mockPool.hasTool.mockImplementation((name: string) => name === 'read_resource');
    mockPool.callTool.mockResolvedValue('file contents here');

    const toolCallResponse: FakeResponse = {
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'tu_mcp',
          name: 'read_resource',
          input: { uri: 'file:///tmp/test' },
        },
      ],
    };

    const mock = makeMock([toolCallResponse, doneResponse]);
    const execTool = vi.fn<(r: string, n: string, i: Record<string, unknown>) => Promise<string>>();
    const loop = createAnthropicAgentLoop({
      model: 'm',
      client: mock as unknown as Anthropic,
      executeTool: execTool,
    });

    const stdioServer: McpServerConfig = { type: 'stdio', name: 'fs', command: 'node', args: [] };
    const result = await loop.run({ ...baseInput, mcpServers: [stdioServer] });

    expect(mockPool.callTool).toHaveBeenCalledWith('read_resource', { uri: 'file:///tmp/test' });
    expect(execTool).not.toHaveBeenCalled();
    expect(result.done.actionable).toBe(true);
  });

  it('closes the pool after a successful run', async () => {
    const mock = makeMock([doneResponse]);
    const loop = createAnthropicAgentLoop({
      model: 'm',
      client: mock as unknown as Anthropic,
      executeTool: noopExecuteTool,
    });

    const stdioServer: McpServerConfig = { type: 'stdio', name: 'fs', command: 'node', args: [] };
    await loop.run({ ...baseInput, mcpServers: [stdioServer] });

    expect(mockPool.close).toHaveBeenCalledOnce();
  });

  it('closes the pool even when the loop throws', async () => {
    const mock = makeMock([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'oops' }] }]);
    const loop = createAnthropicAgentLoop({
      model: 'm',
      client: mock as unknown as Anthropic,
      executeTool: noopExecuteTool,
    });

    const stdioServer: McpServerConfig = { type: 'stdio', name: 'fs', command: 'node', args: [] };
    await expect(loop.run({ ...baseInput, mcpServers: [stdioServer] })).rejects.toThrow(FerryError);

    expect(mockPool.close).toHaveBeenCalledOnce();
  });

  it('does not call pool.connect when no stdio servers are given', async () => {
    const mock = makeMock([doneResponse]);
    const loop = createAnthropicAgentLoop({
      model: 'm',
      client: mock as unknown as Anthropic,
      executeTool: noopExecuteTool,
    });

    await loop.run(baseInput);

    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('returns is_error tool result when stdio MCP tool throws', async () => {
    mockPool.getTools.mockReturnValue([
      { name: 'fail_tool', description: 'Fails', input_schema: { type: 'object', properties: {} } },
    ]);
    mockPool.hasTool.mockImplementation((name: string) => name === 'fail_tool');
    mockPool.callTool.mockRejectedValue(new Error('permission denied'));

    let capturedToolResults: unknown[] | null = null;
    const capturingMock = {
      messages: {
        create: vi
          .fn()
          .mockImplementation(
            async (params: { messages: Array<{ role: string; content: unknown }> }) => {
              if (params.messages.length >= 3) {
                const last = params.messages[params.messages.length - 1];
                capturedToolResults = Array.isArray(last.content)
                  ? (last.content as unknown[])
                  : null;
              }
              if (params.messages.length <= 2) {
                return {
                  stop_reason: 'tool_use',
                  content: [{ type: 'tool_use', id: 'tu_fail', name: 'fail_tool', input: {} }],
                  usage: { input_tokens: 5, output_tokens: 5 },
                };
              }
              return {
                stop_reason: 'tool_use',
                content: [
                  {
                    type: 'tool_use',
                    id: 'tu_done',
                    name: 'done',
                    input: { actionable: false, summary: 'gave up' },
                  },
                ],
                usage: { input_tokens: 5, output_tokens: 5 },
              };
            },
          ),
      },
      beta: { messages: { create: vi.fn() } },
    };

    const loop = createAnthropicAgentLoop({
      model: 'm',
      client: capturingMock as unknown as Anthropic,
      executeTool: noopExecuteTool,
    });

    const stdioServer: McpServerConfig = { type: 'stdio', name: 'fs', command: 'node', args: [] };
    await loop.run({ ...baseInput, mcpServers: [stdioServer] });

    expect(capturedToolResults).not.toBeNull();
    expect(capturedToolResults).toContainEqual(
      expect.objectContaining({
        type: 'tool_result',
        is_error: true,
        content: 'permission denied',
      }),
    );
  });
});

describe('createAnthropicAgentLoop — LOG_VERBOSITY=debug structured events', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    restorePoolDefaults();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('emits debug "turn" record when LOG_VERBOSITY=debug', async () => {
    vi.stubEnv('LOG_VERBOSITY', 'debug');
    const { logger, records } = createTestLogger('evt-test', 'ferry:dev-loop');
    const mock = makeMock([doneResponse]);
    const loop = createAnthropicAgentLoop({
      model: 'm',
      client: mock as unknown as Anthropic,
      executeTool: noopExecuteTool,
      logger,
    });

    await loop.run(baseInput);

    const turnRecord = records.find((r) => r.level === 'debug' && r.message === 'turn');
    expect(turnRecord).toBeDefined();
    expect(turnRecord).toMatchObject({
      type: 'turn',
      iter: 1,
      depth: 0,
      stop_reason: 'tool_use',
    });
    expect(typeof turnRecord?.['elapsed_ms']).toBe('number');
  });

  it('emits debug "result" record on completion when LOG_VERBOSITY=debug', async () => {
    vi.stubEnv('LOG_VERBOSITY', 'debug');
    const { logger, records } = createTestLogger('evt-test', 'ferry:dev-loop');
    const mock = makeMock([doneResponse]);
    const loop = createAnthropicAgentLoop({
      model: 'm',
      client: mock as unknown as Anthropic,
      executeTool: noopExecuteTool,
      logger,
    });

    await loop.run(baseInput);

    const resultRecord = records.find((r) => r.level === 'debug' && r.message === 'result');
    expect(resultRecord).toBeDefined();
    expect(resultRecord).toMatchObject({
      type: 'result',
      subtype: 'success',
      iterations: 1,
    });
    expect(typeof resultRecord?.['elapsed_ms']).toBe('number');
  });

  it('does not emit debug records when LOG_VERBOSITY is unset', async () => {
    vi.stubEnv('LOG_VERBOSITY', '');
    const { logger, records } = createTestLogger('evt-test', 'ferry:dev-loop');
    const mock = makeMock([doneResponse]);
    const loop = createAnthropicAgentLoop({
      model: 'm',
      client: mock as unknown as Anthropic,
      executeTool: noopExecuteTool,
      logger,
    });

    await loop.run(baseInput);

    expect(records.filter((r) => r.level === 'debug')).toHaveLength(0);
  });

  it('emits structured "turn" info records per iteration', async () => {
    const { logger, records } = createTestLogger('evt-test', 'ferry:dev-loop');
    const mock = makeMock([doneResponse]);
    const loop = createAnthropicAgentLoop({
      model: 'm',
      client: mock as unknown as Anthropic,
      executeTool: noopExecuteTool,
      logger,
    });

    await loop.run(baseInput);

    const turnInfoRecords = records.filter((r) => r.level === 'info' && r.message === 'turn');
    expect(turnInfoRecords.length).toBeGreaterThanOrEqual(1);
    expect(turnInfoRecords[0]).toMatchObject({
      level: 'info',
      correlation_id: 'evt-test',
      iter: 1,
      depth: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Message history pruning
// ---------------------------------------------------------------------------

type CapturedMessage = { role: string; content: unknown };

const STUB_VALUE = '[truncated: tool result elided to save context]';

function makeMultiTurnMock(totalToolCalls: number) {
  const capturedRequests: CapturedMessage[][] = [];
  let callCount = 0;

  const createFn = vi.fn().mockImplementation(async (params: { messages: CapturedMessage[] }) => {
    capturedRequests.push(JSON.parse(JSON.stringify(params.messages)) as CapturedMessage[]);
    callCount++;
    if (callCount <= totalToolCalls) {
      return {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: `tu_${callCount}`,
            name: 'read_file',
            input: { path: `file${callCount}.ts` },
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    }
    return {
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'tu_done',
          name: 'done',
          input: { actionable: true, summary: 'ok' },
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    };
  });

  const mockClient = {
    messages: { create: createFn },
    beta: { messages: { create: vi.fn() } },
  };

  return { capturedRequests, mockClient, createFn };
}

describe('createAnthropicAgentLoop — message history pruning', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    restorePoolDefaults();
  });

  it('stubs older tool-result bodies after KEEP_LAST_TURNS threshold and preserves tool_use_id linkage', async () => {
    // 12 tool-call turns + 1 done turn = 13 API calls total.
    // KEEP_LAST_TURNS=6 → pruning kicks in when messages.length > 13 (turn 8+).
    const TOTAL_TOOL_CALLS = 12;
    const { capturedRequests, mockClient } = makeMultiTurnMock(TOTAL_TOOL_CALLS);

    const execTool = vi.fn().mockResolvedValue('file contents');
    const loop = createAnthropicAgentLoop({
      model: 'm',
      client: mockClient as unknown as Anthropic,
      executeTool: execTool,
    });

    await loop.run(baseInput);

    expect(capturedRequests).toHaveLength(TOTAL_TOOL_CALLS + 1);

    // At the last (13th) call: messages had 1 + 12*2 = 25 entries before the call,
    // cutoff = 25 - 12 = 13 → indices 1..12 are checked.
    // User-tool-result messages sit at even indices (2, 4, 6, …, 12) — all stubbed.
    const lastMessages = capturedRequests[capturedRequests.length - 1];

    // index 0: initial prompt must be untouched
    const initial = lastMessages[0];
    expect(initial.role).toBe('user');
    expect((initial.content as Array<{ text: string }>)[0].text).toBe('p');

    // index 2: first tool-result message — should be stubbed
    const firstToolResultMsg = lastMessages[2];
    expect(firstToolResultMsg.role).toBe('user');
    const firstContent = firstToolResultMsg.content as Array<{
      type: string;
      tool_use_id: string;
      content: string;
    }>;
    expect(firstContent[0].type).toBe('tool_result');
    expect(firstContent[0].content).toBe(STUB_VALUE);
    // tool_use_id linkage must be preserved
    expect(firstContent[0].tool_use_id).toBe('tu_1');

    // index 4: second tool-result also stubbed, id points to tu_2
    const secondToolResultMsg = lastMessages[4];
    const secondContent = secondToolResultMsg.content as Array<{
      type: string;
      tool_use_id: string;
      content: string;
    }>;
    expect(secondContent[0].content).toBe(STUB_VALUE);
    expect(secondContent[0].tool_use_id).toBe('tu_2');
  });

  it('pruning is idempotent — already-stubbed entries stay stubbed with the same value across turns', async () => {
    // 14 tool-call turns + 1 done = 15 API calls — ensures multiple prune passes happen.
    const TOTAL_TOOL_CALLS = 14;
    const { capturedRequests, mockClient } = makeMultiTurnMock(TOTAL_TOOL_CALLS);

    const execTool = vi.fn().mockResolvedValue('file contents');
    const loop = createAnthropicAgentLoop({
      model: 'm',
      client: mockClient as unknown as Anthropic,
      executeTool: execTool,
    });

    await loop.run(baseInput);

    // Find the first captured turn where any tool-result was stubbed.
    const firstPrunedTurn = capturedRequests.findIndex((msgs) =>
      msgs.some(
        (m) =>
          m.role === 'user' &&
          Array.isArray(m.content) &&
          (m.content as Array<{ type: string; content: unknown }>).some(
            (b) => b.type === 'tool_result' && b.content === STUB_VALUE,
          ),
      ),
    );

    expect(firstPrunedTurn).toBeGreaterThan(-1);

    // In every subsequent turn the same indices must still carry STUB_VALUE.
    for (let turn = firstPrunedTurn + 1; turn < capturedRequests.length; turn++) {
      const prev = capturedRequests[firstPrunedTurn];
      const curr = capturedRequests[turn];

      for (let msgIdx = 1; msgIdx < prev.length; msgIdx++) {
        const prevMsg = prev[msgIdx];
        if (prevMsg.role !== 'user' || !Array.isArray(prevMsg.content)) continue;

        const prevContent = prevMsg.content as Array<{
          type: string;
          tool_use_id: string;
          content: unknown;
        }>;
        const stubbedBlocks = prevContent.filter(
          (b) => b.type === 'tool_result' && b.content === STUB_VALUE,
        );
        if (stubbedBlocks.length === 0) continue;

        if (msgIdx >= curr.length) continue;
        const currMsg = curr[msgIdx];
        const currContent = currMsg.content as Array<{
          type: string;
          tool_use_id: string;
          content: unknown;
        }>;

        for (const stubbed of stubbedBlocks) {
          const match = currContent.find(
            (b) => b.type === 'tool_result' && b.tool_use_id === stubbed.tool_use_id,
          );
          expect(match?.content).toBe(STUB_VALUE);
        }
      }
    }
  });
});
