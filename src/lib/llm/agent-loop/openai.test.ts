import { describe, it, expect, vi, beforeEach } from 'vitest';
import OpenAI from 'openai';
import { FerryError } from '../../errors/index.js';
import { createOpenAIAgentLoop } from './openai.js';
import type { McpServerConfig } from './types.js';

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

type FakeChoice = {
  finish_reason: string;
  message: {
    role: 'assistant';
    content: string | null;
    refusal: string | null;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
  };
};

type FakeResponse = {
  choices: FakeChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number };
};

function makeDoneResponse(): FakeResponse {
  return {
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          refusal: null,
          tool_calls: [
            {
              id: 'tc_done',
              type: 'function',
              function: {
                name: 'done',
                arguments: JSON.stringify({ actionable: true, summary: 'done' }),
              },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
}

function makeToolCallResponse(
  name: string,
  args: Record<string, unknown>,
  id = 'tc_1',
): FakeResponse {
  return {
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          refusal: null,
          tool_calls: [
            { id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 20, completion_tokens: 10 },
  };
}

function makeClient(responses: FakeResponse[]): OpenAI {
  let idx = 0;
  const create = vi.fn().mockImplementation(async () => {
    return responses[idx++];
  });
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

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

describe('createOpenAIAgentLoop — basic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restorePoolDefaults();
  });

  it('calls done and returns result', async () => {
    const client = makeClient([makeDoneResponse()]);
    const loop = createOpenAIAgentLoop({ model: 'm', client, executeTool: noopExecuteTool });
    const result = await loop.run(baseInput);
    expect(result.done.actionable).toBe(true);
    expect(result.done.summary).toBe('done');
    expect(result.iterations).toBe(1);
  });

  it('accumulates token usage across turns', async () => {
    const execTool = vi.fn().mockResolvedValue('file content');
    const client = makeClient([
      makeToolCallResponse('read_file', { path: 'x.ts' }),
      makeDoneResponse(),
    ]);
    const loop = createOpenAIAgentLoop({ model: 'm', client, executeTool: execTool });
    const result = await loop.run(baseInput);
    expect(result.usage.input_tokens).toBe(30);
    expect(result.usage.output_tokens).toBe(15);
    expect(result.iterations).toBe(2);
  });

  it('dispatches tool calls to executeTool', async () => {
    const execTool = vi.fn().mockResolvedValueOnce('contents');
    const client = makeClient([
      makeToolCallResponse('read_file', { path: 'src/index.ts' }),
      makeDoneResponse(),
    ]);
    const loop = createOpenAIAgentLoop({ model: 'm', client, executeTool: execTool });
    await loop.run(baseInput);
    expect(execTool).toHaveBeenCalledWith('/r', 'read_file', { path: 'src/index.ts' });
  });

  it('tracks tool counts and call records', async () => {
    const execTool = vi.fn().mockResolvedValue('ok');
    const responses = [
      makeToolCallResponse('read_file', { path: 'a.ts' }, 'tc_a'),
      makeToolCallResponse('read_file', { path: 'b.ts' }, 'tc_b'),
      makeDoneResponse(),
    ];
    const client = makeClient(responses);
    const loop = createOpenAIAgentLoop({ model: 'm', client, executeTool: execTool });
    const result = await loop.run(baseInput);
    expect(result.toolCounts['read_file']).toBe(2);
    expect(result.toolCallRecords.length).toBe(2);
  });

  it('throws FerryError when finish_reason is stop with no tool calls', async () => {
    const stopResponse: FakeResponse = {
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'I am done.', refusal: null },
        },
      ],
    };
    const client = makeClient([stopResponse]);
    const loop = createOpenAIAgentLoop({ model: 'm', client, executeTool: noopExecuteTool });
    await expect(loop.run(baseInput)).rejects.toThrow(FerryError);
  });

  it('handles commit_progress tool calls', async () => {
    const commitProgress = vi.fn().mockResolvedValue('committed sha abc123');
    const client = makeClient([
      makeToolCallResponse('commit_progress', { message: 'feat: add feature' }),
      makeDoneResponse(),
    ]);
    const loop = createOpenAIAgentLoop({
      model: 'm',
      client,
      executeTool: noopExecuteTool,
      commitProgress,
    });
    await loop.run(baseInput);
    expect(commitProgress).toHaveBeenCalledWith(
      '/r',
      'ferry/TEST-1',
      'feat: add feature',
      expect.any(Function),
    );
  });

  it('closes the pool after a successful run', async () => {
    const client = makeClient([makeDoneResponse()]);
    const loop = createOpenAIAgentLoop({ model: 'm', client, executeTool: noopExecuteTool });
    await loop.run(baseInput);
    expect(mockPool.close).toHaveBeenCalledOnce();
  });

  it('closes the pool even when the loop throws', async () => {
    const stopResponse: FakeResponse = {
      choices: [
        { finish_reason: 'stop', message: { role: 'assistant', content: 'oops', refusal: null } },
      ],
    };
    const client = makeClient([stopResponse]);
    const loop = createOpenAIAgentLoop({ model: 'm', client, executeTool: noopExecuteTool });
    await expect(loop.run(baseInput)).rejects.toThrow(FerryError);
    expect(mockPool.close).toHaveBeenCalledOnce();
  });
});

describe('createOpenAIAgentLoop — HTTP MCP rejection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restorePoolDefaults();
  });

  it('throws FerryError for HTTP MCP servers', async () => {
    const client = makeClient([makeDoneResponse()]);
    const loop = createOpenAIAgentLoop({ model: 'm', client, executeTool: noopExecuteTool });
    const server: McpServerConfig = { name: 'ctx', url: 'https://mcp.ctx.com/mcp' };
    await expect(loop.run({ ...baseInput, mcpServers: [server] })).rejects.toThrow(FerryError);
  });

  it('does not throw for stdio MCP servers', async () => {
    const client = makeClient([makeDoneResponse()]);
    const loop = createOpenAIAgentLoop({ model: 'm', client, executeTool: noopExecuteTool });
    const server: McpServerConfig = { type: 'stdio', name: 'fs', command: 'node', args: [] };
    await expect(loop.run({ ...baseInput, mcpServers: [server] })).resolves.toBeDefined();
  });
});

describe('createOpenAIAgentLoop — stdio MCP tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restorePoolDefaults();
  });

  it('dispatches stdio MCP tool calls to the pool', async () => {
    mockPool.getTools.mockReturnValue([
      {
        name: 'read_resource',
        description: 'Read',
        input_schema: { type: 'object', properties: {} },
      },
    ]);
    mockPool.hasTool.mockImplementation((n: string) => n === 'read_resource');
    mockPool.callTool.mockResolvedValue('resource contents');

    const client = makeClient([
      makeToolCallResponse('read_resource', { uri: 'file:///tmp/x' }),
      makeDoneResponse(),
    ]);
    const execTool = vi.fn();
    const loop = createOpenAIAgentLoop({ model: 'm', client, executeTool: execTool });
    const stdioServer: McpServerConfig = { type: 'stdio', name: 'fs', command: 'node', args: [] };
    const result = await loop.run({ ...baseInput, mcpServers: [stdioServer] });
    expect(mockPool.callTool).toHaveBeenCalledWith('read_resource', { uri: 'file:///tmp/x' });
    expect(execTool).not.toHaveBeenCalled();
    expect(result.done.actionable).toBe(true);
  });
});

describe('createOpenAIAgentLoop — budget cap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restorePoolDefaults();
  });

  it('throws spend-cap when total tokens exceed the cap', async () => {
    const toolResp: FakeResponse = {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            refusal: null,
            tool_calls: [
              {
                id: 'tc_r',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"x.ts"}' },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 600, completion_tokens: 400 }, // total 1000 = exceeds 999 cap
    };
    const execTool = vi.fn().mockResolvedValue('content');
    const client = makeClient([toolResp, makeDoneResponse()]);
    const loop = createOpenAIAgentLoop({
      model: 'm',
      client,
      executeTool: execTool,
      maxInputTokens: 999,
    });
    const err = await loop.run(baseInput).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FerryError);
    expect((err as FerryError).code).toBe('spend-cap');
  });

  it('does not trip cap when tokens stay under limit', async () => {
    const toolResp: FakeResponse = {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            refusal: null,
            tool_calls: [
              {
                id: 'tc_r',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"x.ts"}' },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 400, completion_tokens: 200 }, // total 600 < 1000 cap
    };
    const execTool = vi.fn().mockResolvedValue('content');
    const client = makeClient([toolResp, makeDoneResponse()]);
    const loop = createOpenAIAgentLoop({
      model: 'm',
      client,
      executeTool: execTool,
      maxInputTokens: 1000,
    });
    await expect(loop.run(baseInput)).resolves.toBeDefined();
  });
});

describe('createOpenAIAgentLoop — budget warnings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restorePoolDefaults();
  });

  function makeCapturingClient(responses: FakeResponse[]) {
    let idx = 0;
    const calls: Array<{ messages: unknown[]; tools: unknown[] }> = [];
    const create = vi
      .fn()
      .mockImplementation(async (params: { messages: unknown[]; tools: unknown[] }) => {
        calls.push({
          messages: JSON.parse(JSON.stringify(params.messages)) as unknown[],
          tools: JSON.parse(JSON.stringify(params.tools ?? [])) as unknown[],
        });
        return responses[idx++];
      });
    const client = { chat: { completions: { create } } } as unknown as OpenAI;
    return { client, calls };
  }

  it('injects 70% warning when budget crosses 70%', async () => {
    const toolResp: FakeResponse = {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            refusal: null,
            tool_calls: [
              {
                id: 'tc_r',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"x.ts"}' },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 750, completion_tokens: 0 }, // 75% of 1000
    };
    const execTool = vi.fn().mockResolvedValue('content');
    const { client, calls } = makeCapturingClient([toolResp, makeDoneResponse()]);
    const loop = createOpenAIAgentLoop({
      model: 'm',
      client,
      executeTool: execTool,
      maxInputTokens: 1000,
    });
    await loop.run(baseInput);
    // iter 2 messages should contain the 70% warning
    expect(calls.length).toBe(2);
    const iter2Messages = calls[1].messages as Array<{ role: string; content: unknown }>;
    const hasWarning = iter2Messages.some(
      (m) =>
        (m.role === 'user' || m.role === 'system') &&
        typeof m.content === 'string' &&
        m.content.includes('[ferry]'),
    );
    // Also check for array content
    const hasWarningInArray = iter2Messages.some(
      (m) =>
        Array.isArray(m.content) &&
        (m.content as Array<{ type: string; text?: string }>).some(
          (b) => b.type === 'text' && typeof b.text === 'string' && b.text.includes('[ferry]'),
        ),
    );
    expect(hasWarning || hasWarningInArray).toBe(true);
  });

  it('restricts tools to commit-and-stop set at 85%', async () => {
    const toolResp: FakeResponse = {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            refusal: null,
            tool_calls: [
              {
                id: 'tc_r',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"x.ts"}' },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 900, completion_tokens: 0 }, // 90% of 1000
    };
    const execTool = vi.fn().mockResolvedValue('content');
    const toolDefs = ['read_file', 'bash', 'done', 'list_dir'].map((n) => ({
      name: n,
      description: n,
      input_schema: { type: 'object' as const, properties: {} },
    }));
    const { client, calls } = makeCapturingClient([toolResp, makeDoneResponse()]);
    const loop = createOpenAIAgentLoop({
      model: 'm',
      client,
      executeTool: execTool,
      maxInputTokens: 1000,
    });
    await loop.run({ ...baseInput, tools: toolDefs });
    // iter 2 tools should exclude read_file and list_dir
    const iter2Tools = calls[1].tools as Array<{ type: string; function?: { name: string } }>;
    const toolNames = new Set(
      iter2Tools.filter((t) => t.type === 'function').map((t) => t.function?.name),
    );
    expect(toolNames.has('bash')).toBe(true);
    expect(toolNames.has('done')).toBe(true);
    expect(toolNames.has('read_file')).toBe(false);
    expect(toolNames.has('list_dir')).toBe(false);
  });
});

describe('createOpenAIAgentLoop — iteration cap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restorePoolDefaults();
  });

  it('throws iteration-cap-exceeded when maxIterations is reached', async () => {
    const execTool = vi.fn().mockResolvedValue('ok');
    // Always return a tool call — never done.
    const create = vi.fn().mockResolvedValue(makeToolCallResponse('read_file', { path: 'x.ts' }));
    const client = { chat: { completions: { create } } } as unknown as OpenAI;
    const loop = createOpenAIAgentLoop({
      model: 'm',
      client,
      executeTool: execTool,
      maxIterations: 2,
    });
    const err = await loop.run(baseInput).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FerryError);
    expect((err as FerryError).context).toMatchObject({ reason: 'iteration-cap-exceeded' });
  });
});
