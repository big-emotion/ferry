import { describe, it, expect, vi, beforeEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { FerryError } from '../../errors/index.js';
import { createAnthropicAgentLoop } from './anthropic.js';
import type { McpServerConfig } from './types.js';

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

function makeMock(
  regularResponses: FakeResponse[],
  betaResponses?: FakeResponse[],
) {
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

const noopExecuteTool = vi.fn<
  (r: string, n: string, i: Record<string, unknown>) => Promise<string>
>();

const baseInput = {
  system: 's',
  initialPrompt: 'p',
  tools: [],
  repoRoot: '/r',
  branchName: 'ferry/TEST-1',
  secretScan: async () => {},
};

describe('createAnthropicAgentLoop — MCP connector', () => {
  beforeEach(() => {
    vi.resetAllMocks();
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

    const execTool = vi.fn<(r: string, n: string, i: Record<string, unknown>) => Promise<string>>()
      .mockResolvedValueOnce('file content');

    const mock = makeMock([], [
      firstResponse,
      { ...doneResponse, usage: { input_tokens: 80, output_tokens: 20 } },
    ]);
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
