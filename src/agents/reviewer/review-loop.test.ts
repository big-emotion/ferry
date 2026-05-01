import { describe, it, expect, vi, afterEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {
  runReviewLoop,
  detectMergeConflicts,
  buildFileList,
  MAX_PATCH_CHARS,
} from './review-loop.js';
import type { PrFile } from './review-loop.js';
import type { CIRunner } from '../../lib/dispatch/runner/types.js';
import { FerryError } from '../../lib/errors/index.js';

type FakeMessage = {
  stop_reason: string;
  content: Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }>;
  usage: { input_tokens: number; output_tokens: number };
};

function makeAnthropicMock(responses: FakeMessage[]) {
  let idx = 0;
  const create = vi.fn().mockImplementation(async () => {
    const r = responses[idx++];
    return {
      stop_reason: r.stop_reason,
      content: r.content,
      usage: r.usage,
    };
  });
  return {
    messages: { create },
    create,
  };
}

const finishReviewResponse: FakeMessage = {
  stop_reason: 'tool_use',
  content: [
    {
      type: 'tool_use',
      id: 'tu_finish',
      name: 'finish_review',
      input: { approved: true, comment: 'LGTM' },
    },
  ],
  usage: { input_tokens: 100, output_tokens: 50 },
};

const baseOpts = {
  model: 'm',
  system: 'sys',
  initialPrompt: 'review this',
  fileMap: new Map<string, string | undefined>(),
  runner: {} as unknown as CIRunner,
  owner: 'org',
  repo: 'repo',
  headSha: 'abc123',
};

describe('runReviewLoop', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('completes when finish_review is called', async () => {
    const mock = makeAnthropicMock([finishReviewResponse]);
    const result = await runReviewLoop({
      ...baseOpts,
      anthropic: mock as unknown as Anthropic,
    });
    expect(result.result.approved).toBe(true);
    expect(result.result.comment).toBe('LGTM');
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
  });

  it('throws FerryError on unexpected stop_reason', async () => {
    const mock = makeAnthropicMock([
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'done' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    ]);
    await expect(
      runReviewLoop({ ...baseOpts, anthropic: mock as unknown as Anthropic }),
    ).rejects.toThrow(FerryError);
  });

  it('emits debug "turn" JSON event when LOG_VERBOSITY=debug', async () => {
    vi.stubEnv('LOG_VERBOSITY', 'debug');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mock = makeAnthropicMock([finishReviewResponse]);

    await runReviewLoop({ ...baseOpts, anthropic: mock as unknown as Anthropic });

    const jsonCalls = spy.mock.calls
      .map((c) => c[0] as string)
      .filter((s) => typeof s === 'string' && s.startsWith('{'));
    const turnRaw = jsonCalls.find((s) => s.includes('"type":"turn"'));
    expect(turnRaw).toBeDefined();
    const turnEvent = JSON.parse(turnRaw!) as Record<string, unknown>;
    expect(turnEvent).toMatchObject({
      type: 'turn',
      iter: 1,
      depth: 0,
      stop_reason: 'tool_use',
    });
    expect(typeof turnEvent['elapsed_ms']).toBe('number');
  });

  it('emits debug "result" JSON event on success when LOG_VERBOSITY=debug', async () => {
    vi.stubEnv('LOG_VERBOSITY', 'debug');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mock = makeAnthropicMock([finishReviewResponse]);

    await runReviewLoop({ ...baseOpts, anthropic: mock as unknown as Anthropic });

    const jsonCalls = spy.mock.calls
      .map((c) => c[0] as string)
      .filter((s) => typeof s === 'string' && s.startsWith('{'));
    const resultRaw = jsonCalls.find((s) => s.includes('"type":"result"'));
    expect(resultRaw).toBeDefined();
    const resultEvent = JSON.parse(resultRaw!) as Record<string, unknown>;
    expect(resultEvent).toMatchObject({
      type: 'result',
      subtype: 'success',
      iterations: 1,
    });
    expect(typeof resultEvent['elapsed_ms']).toBe('number');
  });

  it('does not emit JSON events when LOG_VERBOSITY is unset', async () => {
    vi.stubEnv('LOG_VERBOSITY', '');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mock = makeAnthropicMock([finishReviewResponse]);

    await runReviewLoop({ ...baseOpts, anthropic: mock as unknown as Anthropic });

    const jsonCalls = spy.mock.calls
      .map((c) => c[0] as string)
      .filter((s) => typeof s === 'string' && s.startsWith('{'));
    expect(jsonCalls).toHaveLength(0);
  });

  it('still emits terse [ferry:review-loop] line when debug is on (additive)', async () => {
    vi.stubEnv('LOG_VERBOSITY', 'debug');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mock = makeAnthropicMock([finishReviewResponse]);

    await runReviewLoop({ ...baseOpts, anthropic: mock as unknown as Anthropic });

    const terseCalls = spy.mock.calls
      .map((c) => c[0] as string)
      .filter((s) => typeof s === 'string' && s.includes('[ferry:review-loop]'));
    expect(terseCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('handles get_file_patch for a file in the fileMap', async () => {
    const fileMap = new Map<string, string | undefined>([['src/auth.ts', '+export function login() {}']]);
    const mock = makeAnthropicMock([
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'tu_gfp',
            name: 'get_file_patch',
            input: { filename: 'src/auth.ts' },
          },
        ],
        usage: { input_tokens: 20, output_tokens: 10 },
      },
      finishReviewResponse,
    ]);

    const result = await runReviewLoop({
      ...baseOpts,
      fileMap,
      anthropic: mock as unknown as Anthropic,
    });

    expect(result.result.approved).toBe(true);
    expect(mock.create).toHaveBeenCalledTimes(2);
  });

  it('returns not-found message for get_file_patch when file is absent from fileMap', async () => {
    const fileMap = new Map<string, string | undefined>();
    let capturedToolContent: string | undefined;

    const captureCreate = vi.fn().mockImplementation(
      async (params: { messages: Array<{ role: string; content: unknown }> }) => {
        if (params.messages.length >= 3) {
          const lastMsg = params.messages[params.messages.length - 1];
          if (Array.isArray(lastMsg.content)) {
            const toolResult = (lastMsg.content as Array<{ content?: string }>)[0];
            capturedToolContent = toolResult?.content;
          }
        }
        if (params.messages.length <= 2) {
          return {
            stop_reason: 'tool_use',
            content: [
              {
                type: 'tool_use',
                id: 'tu_gfp',
                name: 'get_file_patch',
                input: { filename: 'missing.ts' },
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
              id: 'tu_finish',
              name: 'finish_review',
              input: { approved: false, comment: 'cannot find file' },
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
    );

    await runReviewLoop({
      ...baseOpts,
      fileMap,
      anthropic: { messages: { create: captureCreate } } as unknown as Anthropic,
    });

    expect(capturedToolContent).toContain('(file not found in PR: missing.ts)');
  });

  it('returns no-patch message for get_file_patch when patch is empty string', async () => {
    const fileMap = new Map<string, string | undefined>([['binary.png', '']]);
    let capturedToolContent: string | undefined;

    const captureCreate = vi.fn().mockImplementation(
      async (params: { messages: Array<{ role: string; content: unknown }> }) => {
        if (params.messages.length >= 3) {
          const lastMsg = params.messages[params.messages.length - 1];
          if (Array.isArray(lastMsg.content)) {
            const toolResult = (lastMsg.content as Array<{ content?: string }>)[0];
            capturedToolContent = toolResult?.content;
          }
        }
        if (params.messages.length <= 2) {
          return {
            stop_reason: 'tool_use',
            content: [
              {
                type: 'tool_use',
                id: 'tu_gfp',
                name: 'get_file_patch',
                input: { filename: 'binary.png' },
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
              id: 'tu_finish',
              name: 'finish_review',
              input: { approved: true, comment: 'ok' },
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
    );

    await runReviewLoop({
      ...baseOpts,
      fileMap,
      anthropic: { messages: { create: captureCreate } } as unknown as Anthropic,
    });

    expect(capturedToolContent).toBe('(no patch — binary, empty, or content unchanged)');
  });

  it('truncates get_file_patch content when patch exceeds MAX_PATCH_CHARS', async () => {
    const longPatch = '+' + 'x'.repeat(MAX_PATCH_CHARS + 100);
    const fileMap = new Map<string, string | undefined>([['big.ts', longPatch]]);
    let capturedToolContent: string | undefined;

    const captureCreate = vi.fn().mockImplementation(
      async (params: { messages: Array<{ role: string; content: unknown }> }) => {
        if (params.messages.length >= 3) {
          const lastMsg = params.messages[params.messages.length - 1];
          if (Array.isArray(lastMsg.content)) {
            const toolResult = (lastMsg.content as Array<{ content?: string }>)[0];
            capturedToolContent = toolResult?.content;
          }
        }
        if (params.messages.length <= 2) {
          return {
            stop_reason: 'tool_use',
            content: [
              {
                type: 'tool_use',
                id: 'tu_gfp',
                name: 'get_file_patch',
                input: { filename: 'big.ts' },
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
              id: 'tu_finish',
              name: 'finish_review',
              input: { approved: true, comment: 'truncated' },
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
    );

    await runReviewLoop({
      ...baseOpts,
      fileMap,
      anthropic: { messages: { create: captureCreate } } as unknown as Anthropic,
    });

    expect(capturedToolContent).toContain('... (truncated)');
    expect(capturedToolContent!.length).toBeLessThan(longPatch.length);
  });

  it('handles get_file_content by calling runner.getFileContent', async () => {
    const getFileContent = vi.fn().mockResolvedValue('function foo() { return 42; }');
    const runner = { getFileContent } as unknown as CIRunner;

    const mock = makeAnthropicMock([
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'tu_gfc',
            name: 'get_file_content',
            input: { filename: 'src/foo.ts' },
          },
        ],
        usage: { input_tokens: 15, output_tokens: 8 },
      },
      finishReviewResponse,
    ]);

    const result = await runReviewLoop({
      ...baseOpts,
      runner,
      anthropic: mock as unknown as Anthropic,
    });

    expect(result.result.approved).toBe(true);
    expect(getFileContent).toHaveBeenCalledWith(
      baseOpts.owner,
      baseOpts.repo,
      'src/foo.ts',
      baseOpts.headSha,
    );
  });

  it('returns is_error tool result for unknown tool names', async () => {
    let capturedToolResult: Array<{ is_error?: boolean; content?: string }> | undefined;

    const captureCreate = vi.fn().mockImplementation(
      async (params: { messages: Array<{ role: string; content: unknown }> }) => {
        if (params.messages.length >= 3) {
          const lastMsg = params.messages[params.messages.length - 1];
          if (Array.isArray(lastMsg.content)) {
            capturedToolResult = lastMsg.content as Array<{ is_error?: boolean; content?: string }>;
          }
        }
        if (params.messages.length <= 2) {
          return {
            stop_reason: 'tool_use',
            content: [
              {
                type: 'tool_use',
                id: 'tu_bad',
                name: 'totally_unknown_tool',
                input: {},
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
              id: 'tu_finish',
              name: 'finish_review',
              input: { approved: true, comment: 'done' },
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
    );

    await runReviewLoop({
      ...baseOpts,
      anthropic: { messages: { create: captureCreate } } as unknown as Anthropic,
    });

    expect(capturedToolResult).toBeDefined();
    expect(capturedToolResult).toContainEqual(
      expect.objectContaining({
        is_error: true,
        content: expect.stringContaining('unknown tool: totally_unknown_tool'),
      }),
    );
  });

  it('throws FerryError when maxIterations is reached without finish_review', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'tu_gfp',
          name: 'get_file_patch',
          input: { filename: 'x.ts' },
        },
      ],
      usage: { input_tokens: 5, output_tokens: 3 },
    });

    await expect(
      runReviewLoop({
        ...baseOpts,
        anthropic: { messages: { create } } as unknown as Anthropic,
        maxIterations: 1,
      }),
    ).rejects.toMatchObject({ code: 'state-invariant' });
  });

  it('accumulates token counts across multiple iterations', async () => {
    const mock = makeAnthropicMock([
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'tu_gfp',
            name: 'get_file_patch',
            input: { filename: 'src/a.ts' },
          },
        ],
        usage: { input_tokens: 100, output_tokens: 40 },
      },
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'tu_finish',
            name: 'finish_review',
            input: { approved: false, comment: 'needs work' },
          },
        ],
        usage: { input_tokens: 200, output_tokens: 60 },
      },
    ]);

    const fileMap = new Map<string, string | undefined>([['src/a.ts', '+code']]);
    const result = await runReviewLoop({
      ...baseOpts,
      fileMap,
      anthropic: mock as unknown as Anthropic,
    });

    expect(result.inputTokens).toBe(300);
    expect(result.outputTokens).toBe(100);
    expect(result.result.approved).toBe(false);
  });
});

describe('detectMergeConflicts', () => {
  const makeFile = (filename: string, patch?: string): PrFile => ({
    filename,
    status: 'modified',
    additions: 1,
    deletions: 0,
    patch,
  });

  it('returns empty array when no conflicts', () => {
    const files = [makeFile('foo.ts', '+const x = 1;')];
    expect(detectMergeConflicts(files)).toEqual([]);
  });

  it('detects <<<<<<< HEAD conflict marker', () => {
    const files = [makeFile('foo.ts', '+<<<<<<< HEAD\n+const x = 1;')];
    expect(detectMergeConflicts(files)).toEqual(['foo.ts']);
  });

  it('detects ======= divider', () => {
    const files = [makeFile('foo.ts', '+=======\n+const y = 2;')];
    expect(detectMergeConflicts(files)).toEqual(['foo.ts']);
  });

  it('detects >>>>>>> marker', () => {
    const files = [makeFile('foo.ts', '+>>>>>>> feature-branch')];
    expect(detectMergeConflicts(files)).toEqual(['foo.ts']);
  });

  it('skips files with no patch', () => {
    const files = [makeFile('binary.png', undefined)];
    expect(detectMergeConflicts(files)).toEqual([]);
  });

  it('returns multiple conflicted filenames', () => {
    const files = [
      makeFile('a.ts', '+<<<<<<< HEAD'),
      makeFile('b.ts', '+const x = 1;'),
      makeFile('c.ts', '+======='),
    ];
    expect(detectMergeConflicts(files)).toEqual(['a.ts', 'c.ts']);
  });

  it('only flags lines added by the PR (starting with +)', () => {
    const files = [makeFile('foo.ts', ' <<<<<<< HEAD\n+const x = 1;')];
    expect(detectMergeConflicts(files)).toEqual([]);
  });
});

describe('buildFileList', () => {
  const makeFile = (
    filename: string,
    status: string,
    additions: number,
    deletions: number,
  ): PrFile => ({ filename, status, additions, deletions });

  it('formats each file with status, additions, deletions, and filename', () => {
    const files = [makeFile('src/auth.ts', 'modified', 12, 3)];
    const result = buildFileList(files);
    expect(result).toContain('src/auth.ts');
    expect(result).toContain('+12');
    expect(result).toContain('-3');
    expect(result).toContain('modified');
  });

  it('joins multiple files with newlines', () => {
    const files = [makeFile('a.ts', 'added', 5, 0), makeFile('b.ts', 'removed', 0, 10)];
    const result = buildFileList(files);
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('a.ts');
    expect(lines[1]).toContain('b.ts');
  });

  it('pads status field for alignment', () => {
    const files = [makeFile('x.ts', 'added', 1, 0)];
    const result = buildFileList(files);
    expect(result.startsWith('added   ')).toBe(true);
  });
});
