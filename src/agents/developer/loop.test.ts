import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FerryError } from '../../lib/error.js';
import { createAnthropicAgentLoop } from '../../lib/llm/agent-loop/anthropic.js';

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

const noopExecuteTool = vi.fn<[string, string, Record<string, unknown>], Promise<string>>();

function makeLoop(
  mock: ReturnType<typeof makeAnthropicMock>,
  execTool = noopExecuteTool,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createAnthropicAgentLoop({ model: 'm', client: mock as any, executeTool: execTool });
}

const defaultRunInput = {
  system: 's',
  initialPrompt: 'p',
  tools: [],
  repoRoot: '/r',
  branchName: 'ferry/TEST-1',
  secretScan: async () => {},
};

describe('createAnthropicAgentLoop', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.FERRY_DEV_MAX_ITERATIONS;
  });

  it('returns done when agent calls done tool', async () => {
    const mock = makeAnthropicMock([
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

    const result = await makeLoop(mock).run(defaultRunInput);

    expect(result.done.actionable).toBe(true);
    expect(result.done.summary).toBe('Added login button');
    expect(result.iterations).toBe(1);
    expect(result.usage.input_tokens).toBe(10);
    expect(result.usage.output_tokens).toBe(20);
  });

  it('accumulates usage across iterations', async () => {
    const execTool = vi.fn<[string, string, Record<string, unknown>], Promise<string>>()
      .mockResolvedValueOnce('file content');

    const mock = makeAnthropicMock([
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

    const result = await makeLoop(mock, execTool).run(defaultRunInput);

    expect(result.usage.input_tokens).toBe(300);
    expect(result.usage.output_tokens).toBe(130);
    expect(result.iterations).toBe(2);
  });

  it('sends tool errors as is_error: true tool_results', async () => {
    const execTool = vi.fn<[string, string, Record<string, unknown>], Promise<string>>()
      .mockRejectedValue(new Error('file not found'));

    let capturedToolResults: unknown[] | null = null;
    const mock = {
      messages: {
        create: vi.fn().mockImplementation(async (params: { messages: Array<{ role: string; content: unknown }> }) => {
          if (params.messages.length >= 3) {
            const lastMsg = params.messages[params.messages.length - 1];
            capturedToolResults = Array.isArray(lastMsg.content) ? lastMsg.content as unknown[] : null;
          }
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
    await createAnthropicAgentLoop({ model: 'm', client: mock as any, executeTool: execTool }).run(defaultRunInput);

    expect(capturedToolResults).not.toBeNull();
    expect(capturedToolResults).toContainEqual(
      expect.objectContaining({ type: 'tool_result', is_error: true, content: 'file not found' }),
    );
  });

  it('throws state-invariant when stop_reason is not tool_use', async () => {
    const mock = makeAnthropicMock([
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'I am done.' }],
      },
    ]);

    await expect(
      makeLoop(mock).run(defaultRunInput),
    ).rejects.toThrow(FerryError);
  });

  it('throws when iteration cap is exceeded', async () => {
    process.env.FERRY_DEV_MAX_ITERATIONS = '2';

    const execTool = vi.fn<[string, string, Record<string, unknown>], Promise<string>>()
      .mockResolvedValue('ok');

    const mock = {
      messages: {
        create: vi.fn().mockResolvedValue({
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: 'x.ts' } }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      },
    };

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createAnthropicAgentLoop({ model: 'm', client: mock as any, executeTool: execTool }).run(defaultRunInput),
    ).rejects.toMatchObject({ code: 'state-invariant' });
  });
});
