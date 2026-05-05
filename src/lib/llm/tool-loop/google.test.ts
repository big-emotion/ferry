import { describe, it, expect, vi, afterEach } from 'vitest';
import { FerryError } from '../../errors/index.js';
import { createTestLogger } from '../../logger/index.js';
import type { ToolDef } from './types.js';

// vi.hoisted so mockGenerateContent is defined when the vi.mock factory runs.
const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
}));

vi.mock('@google/genai', () => {
  const fn = vi.fn().mockImplementation(function (this: unknown) {
    (this as { models: unknown }).models = { generateContent: mockGenerateContent };
  } as unknown as () => void);
  return { GoogleGenAI: fn };
});

import { createGoogleToolCallLoop } from './google.js';

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
  logger: createTestLogger('test', 'tool-loop:google').logger,
};

function makeGoogleResponse(
  fnCalls: Array<{ name: string; args: Record<string, unknown> }>,
  usage = { promptTokenCount: 100, candidatesTokenCount: 40 },
) {
  return {
    functionCalls: fnCalls,
    candidates: [
      {
        content: {
          parts: fnCalls.map((fc) => ({ functionCall: { name: fc.name, args: fc.args } })),
        },
      },
    ],
    usageMetadata: usage,
  };
}

function makeEmptyResponse(usage = { promptTokenCount: 10, candidatesTokenCount: 5 }) {
  return {
    functionCalls: [],
    candidates: [{ content: { parts: [{ text: 'no tool' }] } }],
    usageMetadata: usage,
    text: 'no tool',
  };
}

describe('createGoogleToolCallLoop', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns done result on a single finish turn', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      makeGoogleResponse([{ name: 'finish', args: { result: 'done!' } }]),
    );
    const loop = createGoogleToolCallLoop({ apiKey: 'test-key', model: 'gemini-2.5-flash' });
    const out = await loop.run(baseRunOpts);
    expect(out.done).toBe('done!');
    expect(out.usage.inputTokens).toBe(100);
    expect(out.usage.outputTokens).toBe(40);
    expect(out.iterations).toBe(1);
  });

  it('calls handler then finishes on second turn', async () => {
    const echoSpy = vi.fn().mockReturnValue('echo result');
    mockGenerateContent
      .mockResolvedValueOnce(
        makeGoogleResponse([{ name: 'echo', args: { text: 'hello' } }], {
          promptTokenCount: 50,
          candidatesTokenCount: 20,
        }),
      )
      .mockResolvedValueOnce(
        makeGoogleResponse([{ name: 'finish', args: { result: 'all done' } }], {
          promptTokenCount: 80,
          candidatesTokenCount: 30,
        }),
      );

    const loop = createGoogleToolCallLoop({ apiKey: 'test-key', model: 'gemini-2.5-flash' });
    const out = await loop.run({ ...baseRunOpts, handlers: { echo: echoSpy } });

    expect(echoSpy).toHaveBeenCalledWith({ text: 'hello' });
    expect(out.done).toBe('all done');
    expect(out.usage.inputTokens).toBe(130);
    expect(out.usage.outputTokens).toBe(50);
    expect(out.iterations).toBe(2);
    expect(out.toolCounts.echo).toBe(1);
    expect(out.toolCallRecords).toContainEqual(expect.objectContaining({ name: 'echo' }));
  });

  it('throws FerryError when no function calls are returned', async () => {
    mockGenerateContent.mockResolvedValueOnce(makeEmptyResponse());
    const loop = createGoogleToolCallLoop({ apiKey: 'test-key', model: 'gemini-2.5-flash' });
    await expect(loop.run(baseRunOpts)).rejects.toThrow(FerryError);
  });

  it('throws FerryError when maxIterations is exceeded', async () => {
    mockGenerateContent.mockResolvedValue(
      makeGoogleResponse([{ name: 'echo', args: { text: 'x' } }]),
    );
    const loop = createGoogleToolCallLoop({ apiKey: 'test-key', model: 'gemini-2.5-flash' });
    await expect(loop.run({ ...baseRunOpts, maxIterations: 2 })).rejects.toMatchObject({
      code: 'state-invariant',
    });
  });

  it('accumulates token counts across turns', async () => {
    mockGenerateContent
      .mockResolvedValueOnce(
        makeGoogleResponse([{ name: 'echo', args: { text: 'a' } }], {
          promptTokenCount: 100,
          candidatesTokenCount: 40,
        }),
      )
      .mockResolvedValueOnce(
        makeGoogleResponse([{ name: 'finish', args: { result: 'final' } }], {
          promptTokenCount: 200,
          candidatesTokenCount: 60,
        }),
      );

    const loop = createGoogleToolCallLoop({ apiKey: 'test-key', model: 'gemini-2.5-flash' });
    const out = await loop.run(baseRunOpts);
    expect(out.usage.inputTokens).toBe(300);
    expect(out.usage.outputTokens).toBe(100);
  });
});
