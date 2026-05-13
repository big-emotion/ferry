import { describe, it, expect, vi, afterEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { createAnthropicToolCallLoop } from './anthropic.js';
import { FerryError } from '../../errors/index.js';
import { createTestLogger } from '../../logger/index.js';
import type { ToolDef } from './types.js';

const TOOLS: ToolDef[] = [
  {
    name: 'echo',
    description: 'Echoes input',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'finish',
    description: 'Finishes the loop',
    input_schema: {
      type: 'object',
      properties: { result: { type: 'string' } },
      required: ['result'],
    },
  },
];

type FakeResponse = {
  stop_reason: string;
  content: Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }>;
  usage: { input_tokens: number; output_tokens: number };
};

function makeClient(responses: FakeResponse[]): Anthropic {
  let idx = 0;
  const create = vi.fn().mockImplementation(async () => {
    const r = responses[idx++];
    return { stop_reason: r.stop_reason, content: r.content, usage: r.usage };
  });
  return { messages: { create } } as unknown as Anthropic;
}

const baseRunOpts = {
  system: 'system prompt',
  initialPrompt: 'do something',
  tools: TOOLS,
  handlers: {
    echo: (input: Record<string, unknown>) => String(input.text ?? ''),
  },
  finishTool: 'finish',
  extractDone: (input: Record<string, unknown>) => input.result as string,
  maxIterations: 10,
  maxTokens: 1024,
  logger: createTestLogger('test', 'tool-loop:anthropic').logger,
};

describe('createAnthropicToolCallLoop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns done result on single finish_review turn', async () => {
    const client = makeClient([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu1', name: 'finish', input: { result: 'done!' } }],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    ]);
    const loop = createAnthropicToolCallLoop({ client, model: 'claude-test' });
    const out = await loop.run(baseRunOpts);
    expect(out.done).toBe('done!');
    expect(out.usage.inputTokens).toBe(100);
    expect(out.usage.outputTokens).toBe(50);
    expect(out.iterations).toBe(1);
  });

  it('calls handler and then finishes on second turn', async () => {
    const echoSpy = vi.fn().mockReturnValue('hello back');
    const client = makeClient([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu1', name: 'echo', input: { text: 'hello' } }],
        usage: { input_tokens: 50, output_tokens: 20 },
      },
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu2', name: 'finish', input: { result: 'all done' } }],
        usage: { input_tokens: 80, output_tokens: 30 },
      },
    ]);
    const loop = createAnthropicToolCallLoop({ client, model: 'claude-test' });
    const out = await loop.run({ ...baseRunOpts, handlers: { echo: echoSpy } });

    expect(echoSpy).toHaveBeenCalledWith({ text: 'hello' });
    expect(out.done).toBe('all done');
    expect(out.usage.inputTokens).toBe(130);
    expect(out.usage.outputTokens).toBe(50);
    expect(out.iterations).toBe(2);
    expect(out.toolCounts.echo).toBe(1);
  });

  it('returns is_error for unknown tool names', async () => {
    let capturedMessages: unknown[] = [];
    const create = vi.fn().mockImplementation(async (params: { messages: unknown[] }) => {
      capturedMessages = params.messages;
      if (params.messages.length <= 1) {
        return {
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 'tu_bad', name: 'unknown_tool', input: {} }],
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      }
      return {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu_finish', name: 'finish', input: { result: 'ok' } }],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    });
    const client = { messages: { create } } as unknown as Anthropic;
    const loop = createAnthropicToolCallLoop({ client, model: 'claude-test' });
    await loop.run(baseRunOpts);

    // The third message (index 2) should be the tool result with is_error
    const toolResultMsg = capturedMessages[2] as {
      role: string;
      content: Array<{ is_error?: boolean; content?: string }>;
    };
    expect(toolResultMsg.content).toContainEqual(
      expect.objectContaining({
        is_error: true,
        content: expect.stringContaining('unknown tool: unknown_tool'),
      }),
    );
  });

  it('throws FerryError when stop_reason is not tool_use', async () => {
    const client = makeClient([
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'no tool called' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    ]);
    const loop = createAnthropicToolCallLoop({ client, model: 'claude-test' });
    await expect(loop.run(baseRunOpts)).rejects.toThrow(FerryError);
  });

  it('throws FerryError when maxIterations is exceeded', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu1', name: 'echo', input: { text: 'x' } }],
      usage: { input_tokens: 5, output_tokens: 3 },
    });
    const client = { messages: { create } } as unknown as Anthropic;
    const loop = createAnthropicToolCallLoop({ client, model: 'claude-test' });
    await expect(loop.run({ ...baseRunOpts, maxIterations: 2 })).rejects.toMatchObject({
      code: 'state-invariant',
    });
  });

  it('accumulates token counts across multiple iterations', async () => {
    const client = makeClient([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu1', name: 'echo', input: { text: 'a' } }],
        usage: { input_tokens: 100, output_tokens: 40 },
      },
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu2', name: 'finish', input: { result: 'final' } }],
        usage: { input_tokens: 200, output_tokens: 60 },
      },
    ]);
    const loop = createAnthropicToolCallLoop({ client, model: 'claude-test' });
    const out = await loop.run(baseRunOpts);
    expect(out.usage.inputTokens).toBe(300);
    expect(out.usage.outputTokens).toBe(100);
  });

  describe('thinking parameter wiring', () => {
    function makeSpyClient(): { client: Anthropic; create: ReturnType<typeof vi.fn> } {
      const create = vi.fn().mockImplementation(async () => ({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu1', name: 'finish', input: { result: 'ok' } }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
      const client = { messages: { create } } as unknown as Anthropic;
      return { client, create };
    }

    it('does not pass `thinking` to messages.create when no override is set', async () => {
      const { client, create } = makeSpyClient();
      const loop = createAnthropicToolCallLoop({ client, model: 'claude-test' });
      await loop.run(baseRunOpts);
      expect(create).toHaveBeenCalledOnce();
      const callArgs = create.mock.calls[0][0] as Record<string, unknown>;
      expect('thinking' in callArgs).toBe(false);
    });

    it('passes `thinking: { type: "enabled", budget_tokens: ... }` for on/extended', async () => {
      const { client, create } = makeSpyClient();
      const loop = createAnthropicToolCallLoop({
        client,
        model: 'claude-test',
        thinking: { type: 'enabled', budget_tokens: 8000 },
      });
      await loop.run(baseRunOpts);
      const callArgs = create.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.thinking).toEqual({ type: 'enabled', budget_tokens: 8000 });
    });

    it('passes `thinking: { type: "disabled" }` when override is off', async () => {
      const { client, create } = makeSpyClient();
      const loop = createAnthropicToolCallLoop({
        client,
        model: 'claude-test',
        thinking: { type: 'disabled' },
      });
      await loop.run(baseRunOpts);
      const callArgs = create.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.thinking).toEqual({ type: 'disabled' });
    });
  });
});
