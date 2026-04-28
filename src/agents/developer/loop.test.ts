import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FerryError } from '../../lib/error.js';

// Mock the tools module to avoid file system side effects
vi.mock('./tools.js', () => ({
  TOOL_SCHEMAS: [],
  executeTool: vi.fn(),
}));

import { runAgentLoop } from './loop.js';
import { executeTool } from './tools.js';

const mockExecuteTool = vi.mocked(executeTool);

function makeAnthropicMock(responses: Array<{
  stop_reason: string;
  content: Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }>;
  usage?: { input_tokens: number; output_tokens: number };
}>) {
  let callIndex = 0;
  return {
    messages: {
      create: vi.fn().mockImplementation(async () => {
        const resp = responses[callIndex++];
        return {
          stop_reason: resp.stop_reason,
          content: resp.content,
          usage: resp.usage ?? { input_tokens: 10, output_tokens: 20 },
        };
      }),
    },
  };
}

describe('runAgentLoop', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.FERRY_DEV_MAX_ITERATIONS;
  });

  it('returns done when agent calls done tool', async () => {
    const anthropic = makeAnthropicMock([
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'done',
            input: { actionable: true, summary: 'Added login button', branch_name: 'feat/PROJ-1-login' },
          },
        ],
      },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await runAgentLoop({ anthropic: anthropic as any, model: 'm', system: 's', initialPrompt: 'p', repoRoot: '/r' });

    expect(result.done.actionable).toBe(true);
    expect(result.done.summary).toBe('Added login button');
    expect(result.iterations).toBe(1);
    expect(result.usage.input_tokens).toBe(10);
    expect(result.usage.output_tokens).toBe(20);
  });

  it('accumulates usage across iterations', async () => {
    mockExecuteTool.mockResolvedValueOnce('file content');

    const anthropic = makeAnthropicMock([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: 'foo.ts' } }],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu_2', name: 'done', input: { actionable: false, summary: 'Too vague', reason_if_not_actionable: 'no spec' } }],
        usage: { input_tokens: 200, output_tokens: 80 },
      },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await runAgentLoop({ anthropic: anthropic as any, model: 'm', system: 's', initialPrompt: 'p', repoRoot: '/r' });

    expect(result.usage.input_tokens).toBe(300);
    expect(result.usage.output_tokens).toBe(130);
    expect(result.iterations).toBe(2);
  });

  it('sends tool errors as is_error: true tool_results', async () => {
    mockExecuteTool.mockRejectedValue(new Error('file not found'));

    let capturedToolResults: unknown[] | null = null;
    const anthropic = {
      messages: {
        create: vi.fn().mockImplementation(async (params: { messages: Array<{ role: string; content: unknown }> }) => {
          // On the second call, capture tool results sent for the first iteration
          if (params.messages.length >= 3) {
            const lastMsg = params.messages[params.messages.length - 1];
            capturedToolResults = Array.isArray(lastMsg.content) ? lastMsg.content as unknown[] : null;
          }
          // First call: read_file; second call: done
          if (params.messages.length <= 2) {
            return {
              stop_reason: 'tool_use',
              content: [{ type: 'tool_use', id: 'tu_err', name: 'read_file', input: { path: 'nope.ts' } }],
              usage: { input_tokens: 10, output_tokens: 5 },
            };
          }
          return {
            stop_reason: 'tool_use',
            content: [{ type: 'tool_use', id: 'tu_done', name: 'done', input: { actionable: false, summary: 'Gave up' } }],
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        }),
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await runAgentLoop({ anthropic: anthropic as any, model: 'm', system: 's', initialPrompt: 'p', repoRoot: '/r' });

    expect(capturedToolResults).not.toBeNull();
    expect(capturedToolResults).toContainEqual(
      expect.objectContaining({ type: 'tool_result', is_error: true, content: 'file not found' }),
    );
  });

  it('throws state-invariant when stop_reason is not tool_use', async () => {
    const anthropic = makeAnthropicMock([
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'I am done.' }],
      },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(
      runAgentLoop({ anthropic: anthropic as any, model: 'm', system: 's', initialPrompt: 'p', repoRoot: '/r' }),
    ).rejects.toThrow(FerryError);
  });

  it('throws when iteration cap is exceeded', async () => {
    process.env.FERRY_DEV_MAX_ITERATIONS = '2';

    mockExecuteTool.mockResolvedValue('ok');

    // Always returns a non-done tool call
    const anthropic = {
      messages: {
        create: vi.fn().mockResolvedValue({
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: 'x.ts' } }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(
      runAgentLoop({ anthropic: anthropic as any, model: 'm', system: 's', initialPrompt: 'p', repoRoot: '/r' }),
    ).rejects.toMatchObject({ code: 'state-invariant' });
  });
});
