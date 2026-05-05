import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleGenAI } from '@google/genai';
import { FerryError } from '../../errors/index.js';
import { createGoogleAgentLoop } from './google.js';
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

type FakePart = {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
};

type FakeResponse = {
  candidates?: Array<{
    finishReason?: string;
    content?: { role: string; parts: FakePart[] };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
};

function makeDoneResponse(): FakeResponse {
  return {
    candidates: [
      {
        finishReason: 'STOP',
        content: {
          role: 'model',
          parts: [{ functionCall: { name: 'done', args: { actionable: true, summary: 'done' } } }],
        },
      },
    ],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  };
}

function makeToolCallResponse(
  name: string,
  args: Record<string, unknown>,
  id?: string,
): FakeResponse {
  return {
    candidates: [
      {
        finishReason: 'STOP',
        content: {
          role: 'model',
          parts: [{ functionCall: { name, args, ...(id !== undefined ? { id } : {}) } }],
        },
      },
    ],
    usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 },
  };
}

function makeAi(responses: FakeResponse[]): GoogleGenAI {
  let idx = 0;
  const generateContent = vi.fn().mockImplementation(async () => {
    return responses[idx++];
  });
  return { models: { generateContent } } as unknown as GoogleGenAI;
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

describe('createGoogleAgentLoop — basic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restorePoolDefaults();
  });

  it('calls done and returns result', async () => {
    const ai = makeAi([makeDoneResponse()]);
    const loop = createGoogleAgentLoop({ model: 'm', ai, executeTool: noopExecuteTool });
    const result = await loop.run(baseInput);
    expect(result.done.actionable).toBe(true);
    expect(result.done.summary).toBe('done');
    expect(result.iterations).toBe(1);
  });

  it('accumulates token usage across turns', async () => {
    const execTool = vi.fn().mockResolvedValue('content');
    const ai = makeAi([makeToolCallResponse('read_file', { path: 'x.ts' }), makeDoneResponse()]);
    const loop = createGoogleAgentLoop({ model: 'm', ai, executeTool: execTool });
    const result = await loop.run(baseInput);
    expect(result.usage.input_tokens).toBe(30);
    expect(result.usage.output_tokens).toBe(15);
    expect(result.iterations).toBe(2);
  });

  it('dispatches tool calls to executeTool', async () => {
    const execTool = vi.fn().mockResolvedValueOnce('contents');
    const ai = makeAi([
      makeToolCallResponse('read_file', { path: 'src/index.ts' }),
      makeDoneResponse(),
    ]);
    const loop = createGoogleAgentLoop({ model: 'm', ai, executeTool: execTool });
    await loop.run(baseInput);
    expect(execTool).toHaveBeenCalledWith('/r', 'read_file', { path: 'src/index.ts' });
  });

  it('tracks tool counts and call records', async () => {
    const execTool = vi.fn().mockResolvedValue('ok');
    const ai = makeAi([
      makeToolCallResponse('read_file', { path: 'a.ts' }),
      makeToolCallResponse('read_file', { path: 'b.ts' }),
      makeDoneResponse(),
    ]);
    const loop = createGoogleAgentLoop({ model: 'm', ai, executeTool: execTool });
    const result = await loop.run(baseInput);
    expect(result.toolCounts['read_file']).toBe(2);
    expect(result.toolCallRecords.length).toBe(2);
  });

  it('throws FerryError when response has no function calls', async () => {
    const textOnlyResponse: FakeResponse = {
      candidates: [
        {
          finishReason: 'STOP',
          content: { role: 'model', parts: [{ text: 'I am done.' }] },
        },
      ],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
    };
    const ai = makeAi([textOnlyResponse]);
    const loop = createGoogleAgentLoop({ model: 'm', ai, executeTool: noopExecuteTool });
    await expect(loop.run(baseInput)).rejects.toThrow(FerryError);
  });

  it('handles commit_progress tool calls', async () => {
    const commitProgress = vi.fn().mockResolvedValue('committed');
    const ai = makeAi([
      makeToolCallResponse('commit_progress', { message: 'feat: add feature' }),
      makeDoneResponse(),
    ]);
    const loop = createGoogleAgentLoop({
      model: 'm',
      ai,
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
    const ai = makeAi([makeDoneResponse()]);
    const loop = createGoogleAgentLoop({ model: 'm', ai, executeTool: noopExecuteTool });
    await loop.run(baseInput);
    expect(mockPool.close).toHaveBeenCalledOnce();
  });

  it('closes the pool even when the loop throws', async () => {
    const textOnlyResponse: FakeResponse = {
      candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'oops' }] } }],
    };
    const ai = makeAi([textOnlyResponse]);
    const loop = createGoogleAgentLoop({ model: 'm', ai, executeTool: noopExecuteTool });
    await expect(loop.run(baseInput)).rejects.toThrow(FerryError);
    expect(mockPool.close).toHaveBeenCalledOnce();
  });
});

describe('createGoogleAgentLoop — HTTP MCP rejection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restorePoolDefaults();
  });

  it('throws FerryError for HTTP MCP servers', async () => {
    const ai = makeAi([makeDoneResponse()]);
    const loop = createGoogleAgentLoop({ model: 'm', ai, executeTool: noopExecuteTool });
    const server: McpServerConfig = { name: 'ctx', url: 'https://mcp.ctx.com/mcp' };
    await expect(loop.run({ ...baseInput, mcpServers: [server] })).rejects.toThrow(FerryError);
  });

  it('does not throw for stdio MCP servers', async () => {
    const ai = makeAi([makeDoneResponse()]);
    const loop = createGoogleAgentLoop({ model: 'm', ai, executeTool: noopExecuteTool });
    const server: McpServerConfig = { type: 'stdio', name: 'fs', command: 'node', args: [] };
    await expect(loop.run({ ...baseInput, mcpServers: [server] })).resolves.toBeDefined();
  });
});

describe('createGoogleAgentLoop — stdio MCP tools', () => {
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

    const ai = makeAi([
      makeToolCallResponse('read_resource', { uri: 'file:///tmp/x' }),
      makeDoneResponse(),
    ]);
    const execTool = vi.fn();
    const loop = createGoogleAgentLoop({ model: 'm', ai, executeTool: execTool });
    const stdioServer: McpServerConfig = { type: 'stdio', name: 'fs', command: 'node', args: [] };
    const result = await loop.run({ ...baseInput, mcpServers: [stdioServer] });
    expect(mockPool.callTool).toHaveBeenCalledWith('read_resource', { uri: 'file:///tmp/x' });
    expect(execTool).not.toHaveBeenCalled();
    expect(result.done.actionable).toBe(true);
  });
});

describe('createGoogleAgentLoop — budget cap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restorePoolDefaults();
  });

  it('throws spend-cap when total tokens exceed the cap', async () => {
    const toolResp = makeToolCallResponse('read_file', { path: 'x.ts' });
    toolResp.usageMetadata = { promptTokenCount: 600, candidatesTokenCount: 400 };
    const execTool = vi.fn().mockResolvedValue('content');
    const ai = makeAi([toolResp, makeDoneResponse()]);
    const loop = createGoogleAgentLoop({
      model: 'm',
      ai,
      executeTool: execTool,
      maxInputTokens: 999,
    });
    const err = await loop.run(baseInput).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FerryError);
    expect((err as FerryError).code).toBe('spend-cap');
  });
});

describe('createGoogleAgentLoop — budget warnings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restorePoolDefaults();
  });

  function makeCapturingAi(responses: FakeResponse[]) {
    let idx = 0;
    const calls: Array<{ contents: unknown[]; config: unknown }> = [];
    const generateContent = vi
      .fn()
      .mockImplementation(async (params: { contents: unknown[]; config: unknown }) => {
        calls.push({
          contents: JSON.parse(JSON.stringify(params.contents)) as unknown[],
          config: JSON.parse(JSON.stringify(params.config)) as unknown,
        });
        return responses[idx++];
      });
    const ai = { models: { generateContent } } as unknown as GoogleGenAI;
    return { ai, calls };
  }

  it('injects 70% warning into conversation when budget crosses 70%', async () => {
    const toolResp = makeToolCallResponse('read_file', { path: 'x.ts' });
    toolResp.usageMetadata = { promptTokenCount: 750, candidatesTokenCount: 0 };
    const execTool = vi.fn().mockResolvedValue('content');
    const { ai, calls } = makeCapturingAi([toolResp, makeDoneResponse()]);
    const loop = createGoogleAgentLoop({
      model: 'm',
      ai,
      executeTool: execTool,
      maxInputTokens: 1000,
    });
    await loop.run(baseInput);
    // iter 2 contents should contain a [ferry] text part somewhere
    expect(calls.length).toBe(2);
    const iter2Contents = calls[1].contents as Array<{ role: string; parts: FakePart[] }>;
    const hasWarning = iter2Contents.some((c) =>
      c.parts?.some((p) => typeof p.text === 'string' && p.text.includes('[ferry]')),
    );
    expect(hasWarning).toBe(true);
  });

  it('restricts tools to commit-and-stop set at 85%', async () => {
    const toolResp = makeToolCallResponse('read_file', { path: 'x.ts' });
    toolResp.usageMetadata = { promptTokenCount: 900, candidatesTokenCount: 0 };
    const execTool = vi.fn().mockResolvedValue('content');
    const toolDefs = ['read_file', 'bash', 'done', 'list_dir'].map((n) => ({
      name: n,
      description: n,
      input_schema: { type: 'object' as const, properties: {} },
    }));
    const { ai, calls } = makeCapturingAi([toolResp, makeDoneResponse()]);
    const loop = createGoogleAgentLoop({
      model: 'm',
      ai,
      executeTool: execTool,
      maxInputTokens: 1000,
    });
    await loop.run({ ...baseInput, tools: toolDefs });
    // iter 2 config should contain only commit-and-stop tools
    const iter2Config = calls[1].config as {
      tools?: Array<{ functionDeclarations?: Array<{ name?: string }> }>;
    };
    const toolNames = new Set(
      (iter2Config.tools?.[0]?.functionDeclarations ?? []).map((d) => d.name),
    );
    expect(toolNames.has('bash')).toBe(true);
    expect(toolNames.has('done')).toBe(true);
    expect(toolNames.has('read_file')).toBe(false);
    expect(toolNames.has('list_dir')).toBe(false);
  });
});

describe('createGoogleAgentLoop — iteration cap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restorePoolDefaults();
  });

  it('throws iteration-cap-exceeded when maxIterations is reached', async () => {
    const execTool = vi.fn().mockResolvedValue('ok');
    const generateContent = vi
      .fn()
      .mockResolvedValue(makeToolCallResponse('read_file', { path: 'x.ts' }));
    const ai = { models: { generateContent } } as unknown as GoogleGenAI;
    const loop = createGoogleAgentLoop({
      model: 'm',
      ai,
      executeTool: execTool,
      maxIterations: 2,
    });
    const err = await loop.run(baseInput).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FerryError);
    expect((err as FerryError).context).toMatchObject({ reason: 'iteration-cap-exceeded' });
  });
});
