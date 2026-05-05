import { describe, it, expect, vi, afterEach } from 'vitest';
import { FerryError } from '../../errors/index.js';
import { createTestLogger } from '../../logger/index.js';
import type { ToolDef } from './types.js';

// vi.hoisted so mockCreate is defined when the vi.mock factory runs (ESM hoisting).
const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock('openai', () => {
  const fn = vi.fn().mockImplementation(function (this: unknown) {
    (this as { chat: unknown }).chat = { completions: { create: mockCreate } };
  } as unknown as () => void);
  class RateLimitError extends Error {}
  class APIConnectionError extends Error {
    constructor(opts: { message: string }) {
      super(opts.message);
    }
  }
  class APIError extends Error {
    status = 0;
  }
  Object.assign(fn, { RateLimitError, APIConnectionError, APIError });
  return { default: fn };
});

import { createOpenAIToolCallLoop } from './openai.js';

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
  logger: createTestLogger('test', 'tool-loop:openai').logger,
};

function makeFinishResponse(result: string, usage = { prompt_tokens: 100, completion_tokens: 40 }) {
  return {
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          content: null,
          tool_calls: [
            {
              id: 'tc_finish',
              type: 'function' as const,
              function: { name: 'finish', arguments: JSON.stringify({ result }) },
            },
          ],
        },
      },
    ],
    usage,
  };
}

function makeToolResponse(
  name: string,
  args: Record<string, unknown>,
  usage = { prompt_tokens: 50, completion_tokens: 20 },
) {
  return {
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          content: null,
          tool_calls: [
            {
              id: `tc_${name}`,
              type: 'function' as const,
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
    usage,
  };
}

describe('createOpenAIToolCallLoop', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns done result on a single finish turn', async () => {
    mockCreate.mockResolvedValueOnce(makeFinishResponse('done!'));
    const loop = createOpenAIToolCallLoop({ apiKey: 'test-key', model: 'gpt-4.1-mini' });
    const out = await loop.run(baseRunOpts);
    expect(out.done).toBe('done!');
    expect(out.usage.inputTokens).toBe(100);
    expect(out.usage.outputTokens).toBe(40);
    expect(out.iterations).toBe(1);
  });

  it('calls handler then finishes on second turn', async () => {
    const echoSpy = vi.fn().mockReturnValue('echo result');
    mockCreate
      .mockResolvedValueOnce(
        makeToolResponse('echo', { text: 'hello' }, { prompt_tokens: 50, completion_tokens: 20 }),
      )
      .mockResolvedValueOnce(
        makeFinishResponse('all done', { prompt_tokens: 80, completion_tokens: 30 }),
      );

    const loop = createOpenAIToolCallLoop({ apiKey: 'test-key', model: 'gpt-4.1-mini' });
    const out = await loop.run({ ...baseRunOpts, handlers: { echo: echoSpy } });

    expect(echoSpy).toHaveBeenCalledWith({ text: 'hello' });
    expect(out.done).toBe('all done');
    expect(out.usage.inputTokens).toBe(130);
    expect(out.usage.outputTokens).toBe(50);
    expect(out.iterations).toBe(2);
    expect(out.toolCounts.echo).toBe(1);
    expect(out.toolCallRecords).toContainEqual(expect.objectContaining({ name: 'echo' }));
  });

  it('throws FerryError when finish_reason is not tool_calls', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ finish_reason: 'stop', message: { content: 'no tool', tool_calls: undefined } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    const loop = createOpenAIToolCallLoop({ apiKey: 'test-key', model: 'gpt-4.1-mini' });
    await expect(loop.run(baseRunOpts)).rejects.toThrow(FerryError);
  });

  it('throws FerryError when maxIterations is exceeded', async () => {
    mockCreate.mockResolvedValue(makeToolResponse('echo', { text: 'x' }));
    const loop = createOpenAIToolCallLoop({ apiKey: 'test-key', model: 'gpt-4.1-mini' });
    await expect(loop.run({ ...baseRunOpts, maxIterations: 2 })).rejects.toMatchObject({
      code: 'state-invariant',
    });
  });

  it('accumulates token counts across turns', async () => {
    mockCreate
      .mockResolvedValueOnce(
        makeToolResponse('echo', { text: 'a' }, { prompt_tokens: 100, completion_tokens: 40 }),
      )
      .mockResolvedValueOnce(
        makeFinishResponse('final', { prompt_tokens: 200, completion_tokens: 60 }),
      );

    const loop = createOpenAIToolCallLoop({ apiKey: 'test-key', model: 'gpt-4.1-mini' });
    const out = await loop.run(baseRunOpts);
    expect(out.usage.inputTokens).toBe(300);
    expect(out.usage.outputTokens).toBe(100);
  });
});
