import { describe, it, expect, vi, beforeEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
import { runAgentLoop } from './loop.js';

type FakeMessage = {
  stop_reason: string;
  content: Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }>;
  usage: { input_tokens: number; output_tokens: number };
};

function makeMock(responses: FakeMessage[]) {
  let idx = 0;
  return {
    messages: {
      create: vi.fn().mockImplementation(async () => {
        const r = responses[idx++];
        return { stop_reason: r.stop_reason, content: r.content, usage: r.usage };
      }),
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockExecFileSync = execFileSync as any;

const doneResponse: FakeMessage = {
  stop_reason: 'tool_use',
  content: [
    {
      type: 'tool_use',
      id: 'tu_done',
      name: 'done',
      input: { actionable: true, summary: 'implementation complete' },
    },
  ],
  usage: { input_tokens: 5, output_tokens: 3 },
};

const baseOpts = {
  model: 'm',
  system: 'sys',
  initialPrompt: 'implement it',
  repoRoot: '/repo',
  branchName: 'ferry/TEST-1',
};

/** Returns a create mock that first triggers commit_progress then done. */
function makeCommitProgressCreate(onToolResult?: (result: Record<string, unknown>) => void) {
  return vi
    .fn()
    .mockImplementation(async (params: { messages: Array<{ role: string; content: unknown }> }) => {
      if (params.messages.length >= 3 && onToolResult) {
        const lastMsg = params.messages[params.messages.length - 1];
        if (Array.isArray(lastMsg.content)) {
          const toolRes = (lastMsg.content as Array<Record<string, unknown>>)[0];
          onToolResult(toolRes ?? {});
        }
      }
      if (params.messages.length <= 2) {
        return {
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'tu_cp',
              name: 'commit_progress',
              input: { message: 'feat: checkpoint' },
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
            input: { actionable: true, summary: 'done' },
          },
        ],
        usage: { input_tokens: 5, output_tokens: 3 },
      };
    });
}

describe('runAgentLoop', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('runs to completion when agent calls done', async () => {
    const mock = makeMock([doneResponse]);
    const result = await runAgentLoop({
      ...baseOpts,
      anthropic: mock as unknown as Anthropic,
      secretScan: async () => {},
    });
    expect(result.done.actionable).toBe(true);
    expect(result.done.summary).toBe('implementation complete');
    expect(result.iterations).toBe(1);
  });

  it('accumulates token usage across multiple iterations', async () => {
    const mock = makeMock([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu_r', name: 'read_file', input: { path: 'foo.ts' } }],
        usage: { input_tokens: 100, output_tokens: 30 },
      },
      doneResponse,
    ]);

    const result = await runAgentLoop({
      ...baseOpts,
      anthropic: mock as unknown as Anthropic,
      secretScan: async () => {},
    });

    expect(result.usage.input_tokens).toBeGreaterThanOrEqual(100);
    expect(result.iterations).toBe(2);
  });

  describe('commitProgress callback (via commit_progress tool)', () => {
    it('returns nothing-to-commit when git status is empty', async () => {
      let capturedContent: string | undefined;
      const create = makeCommitProgressCreate((res) => {
        capturedContent = res['content'] as string | undefined;
      });

      mockExecFileSync.mockReturnValueOnce(''); // git add -A
      mockExecFileSync.mockReturnValueOnce(''); // git status (empty → nothing to commit)

      await runAgentLoop({
        ...baseOpts,
        anthropic: { messages: { create } } as unknown as Anthropic,
        secretScan: async () => {},
      });

      expect(capturedContent).toBe('nothing to commit');
    });

    it('returns nothing-to-commit when status is only whitespace', async () => {
      let capturedContent: string | undefined;
      const create = makeCommitProgressCreate((res) => {
        capturedContent = res['content'] as string | undefined;
      });

      mockExecFileSync.mockReturnValueOnce(''); // git add -A
      mockExecFileSync.mockReturnValueOnce('   \n  '); // git status (whitespace only)

      await runAgentLoop({
        ...baseOpts,
        anthropic: { messages: { create } } as unknown as Anthropic,
        secretScan: async () => {},
      });

      expect(capturedContent).toBe('nothing to commit');
    });

    it('commits and pushes when there are staged changes', async () => {
      let capturedContent: string | undefined;
      const create = makeCommitProgressCreate((res) => {
        capturedContent = res['content'] as string | undefined;
      });

      mockExecFileSync.mockReturnValueOnce(''); // git add -A
      mockExecFileSync.mockReturnValueOnce('M src/foo.ts'); // git status
      mockExecFileSync.mockReturnValueOnce(''); // git commit
      mockExecFileSync.mockReturnValueOnce(''); // git push

      await runAgentLoop({
        ...baseOpts,
        anthropic: { messages: { create } } as unknown as Anthropic,
        secretScan: async () => {},
      });

      expect(capturedContent).toBe('committed and pushed');
    });

    it('calls secret scan before committing', async () => {
      const scan = vi.fn().mockResolvedValue(undefined);
      const create = makeCommitProgressCreate();

      mockExecFileSync.mockReturnValueOnce(''); // git add -A
      mockExecFileSync.mockReturnValueOnce('M src/foo.ts'); // git status
      mockExecFileSync.mockReturnValueOnce(''); // git commit
      mockExecFileSync.mockReturnValueOnce(''); // git push

      await runAgentLoop({
        ...baseOpts,
        anthropic: { messages: { create } } as unknown as Anthropic,
        secretScan: scan,
      });

      expect(scan).toHaveBeenCalledOnce();
    });

    it('propagates secret scan failure as is_error tool result', async () => {
      let capturedIsError: boolean | undefined;
      const create = makeCommitProgressCreate((res) => {
        capturedIsError = res['is_error'] as boolean | undefined;
      });

      mockExecFileSync.mockReturnValueOnce(''); // git add -A
      mockExecFileSync.mockReturnValueOnce('M src/secret.ts'); // git status

      await runAgentLoop({
        ...baseOpts,
        anthropic: { messages: { create } } as unknown as Anthropic,
        secretScan: async () => {
          throw new Error('secret detected: AWS key');
        },
      });

      expect(capturedIsError).toBe(true);
      // git commit and git push should NOT have been called — only 2 execFileSync calls
      expect(mockExecFileSync.mock.calls).toHaveLength(2);
    });

    it('propagates push failure as is_error tool result', async () => {
      let capturedIsError: boolean | undefined;
      const create = makeCommitProgressCreate((res) => {
        capturedIsError = res['is_error'] as boolean | undefined;
      });

      mockExecFileSync.mockReturnValueOnce(''); // git add -A
      mockExecFileSync.mockReturnValueOnce('M src/foo.ts'); // git status
      mockExecFileSync.mockReturnValueOnce(''); // git commit
      mockExecFileSync.mockImplementationOnce(() => {
        throw new Error('[rejected] non-fast-forward');
      }); // git push fails

      await runAgentLoop({
        ...baseOpts,
        anthropic: { messages: { create } } as unknown as Anthropic,
        secretScan: async () => {},
      });

      expect(capturedIsError).toBe(true);
    });

    it('pushes to the branch name passed in opts', async () => {
      const create = makeCommitProgressCreate();

      mockExecFileSync.mockReturnValueOnce(''); // git add -A
      mockExecFileSync.mockReturnValueOnce('A new-file.ts'); // git status
      mockExecFileSync.mockReturnValueOnce(''); // git commit
      mockExecFileSync.mockReturnValueOnce(''); // git push

      await runAgentLoop({
        ...baseOpts,
        branchName: 'ferry/PROJ-42',
        anthropic: { messages: { create } } as unknown as Anthropic,
        secretScan: async () => {},
      });

      const pushCall = (mockExecFileSync.mock.calls as Array<[string, string[], unknown]>).find(
        ([, args]) => Array.isArray(args) && args.includes('push'),
      );
      expect(pushCall).toBeDefined();
      expect(pushCall![1]).toContain('ferry/PROJ-42');
      expect(pushCall![1]).toContain('--force-with-lease');
    });
  });
});
