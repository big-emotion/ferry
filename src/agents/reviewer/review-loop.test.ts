import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  runReviewLoop,
  detectMergeConflicts,
  buildFileList,
  MAX_PATCH_CHARS,
} from './review-loop.js';
import type { PrFile } from './review-loop.js';
import type { CIRunner } from '../../lib/dispatch/runner/types.js';
import type {
  ToolCallLoop,
  ToolLoopRunOpts,
  ToolLoopResult,
} from '../../lib/llm/tool-loop/index.js';

/** Creates a mock ToolCallLoop that invokes handlers to simulate an LLM run. */
function makeMockLoop(
  scenario: (
    opts: ToolLoopRunOpts<unknown>,
  ) => Promise<ToolLoopResult<unknown>> | ToolLoopResult<unknown>,
): ToolCallLoop {
  return {
    run: vi.fn().mockImplementation(scenario),
  };
}

/** Simulates a single-turn finish_review call. */
function makeFinishLoop(approved: boolean, comment: string): ToolCallLoop {
  return makeMockLoop(async (opts) => {
    const done = opts.extractDone({ approved, comment });
    return {
      done,
      usage: { inputTokens: 100, outputTokens: 50 },
      iterations: 1,
      toolCounts: {},
      toolCallRecords: [],
    };
  });
}

/** Simulates: call handler once → finish_review. */
function makeToolThenFinishLoop(
  toolName: string,
  toolInput: Record<string, unknown>,
  approved: boolean,
  comment: string,
): ToolCallLoop {
  return makeMockLoop(async (opts) => {
    const handler = opts.handlers[toolName];
    if (handler) await handler(toolInput);
    const done = opts.extractDone({ approved, comment });
    return {
      done,
      usage: { inputTokens: 200, outputTokens: 80 },
      iterations: 2,
      toolCounts: { [toolName]: 1 },
      toolCallRecords: [{ name: toolName, outputSize: 10 }],
    };
  });
}

const baseOpts = {
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
    const loop = makeFinishLoop(true, 'LGTM');
    const result = await runReviewLoop({ ...baseOpts, loop });
    expect(result.result.approved).toBe(true);
    expect(result.result.comment).toBe('LGTM');
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
  });

  it('returns correct iteration count', async () => {
    const loop = makeFinishLoop(false, 'needs work');
    const result = await runReviewLoop({ ...baseOpts, loop });
    expect(result.iterations).toBe(1);
  });

  it('passes get_file_patch handler that returns patch from fileMap', async () => {
    const fileMap = new Map<string, string | undefined>([
      ['src/auth.ts', '+export function login() {}'],
    ]);
    let capturedContent: string | undefined;

    const loop = makeMockLoop(async (opts) => {
      const handler = opts.handlers['get_file_patch'];
      capturedContent = await handler!({ filename: 'src/auth.ts' });
      const done = opts.extractDone({ approved: true, comment: 'ok' });
      return {
        done,
        usage: { inputTokens: 20, outputTokens: 10 },
        iterations: 2,
        toolCounts: {},
        toolCallRecords: [],
      };
    });

    await runReviewLoop({ ...baseOpts, fileMap, loop });
    expect(capturedContent).toBe('+export function login() {}');
  });

  it('get_file_patch returns not-found message for missing file', async () => {
    let capturedContent: string | undefined;
    const loop = makeMockLoop(async (opts) => {
      capturedContent = await opts.handlers['get_file_patch']!({ filename: 'missing.ts' });
      const done = opts.extractDone({ approved: false, comment: 'cannot find file' });
      return {
        done,
        usage: { inputTokens: 10, outputTokens: 5 },
        iterations: 2,
        toolCounts: {},
        toolCallRecords: [],
      };
    });

    await runReviewLoop({ ...baseOpts, loop });
    expect(capturedContent).toContain('(file not found in PR: missing.ts)');
  });

  it('get_file_patch returns no-patch message for empty string', async () => {
    const fileMap = new Map<string, string | undefined>([['binary.png', '']]);
    let capturedContent: string | undefined;
    const loop = makeMockLoop(async (opts) => {
      capturedContent = await opts.handlers['get_file_patch']!({ filename: 'binary.png' });
      const done = opts.extractDone({ approved: true, comment: 'ok' });
      return {
        done,
        usage: { inputTokens: 10, outputTokens: 5 },
        iterations: 2,
        toolCounts: {},
        toolCallRecords: [],
      };
    });

    await runReviewLoop({ ...baseOpts, fileMap, loop });
    expect(capturedContent).toBe('(no patch — binary, empty, or content unchanged)');
  });

  it('truncates patch when it exceeds MAX_PATCH_CHARS', async () => {
    const longPatch = '+' + 'x'.repeat(MAX_PATCH_CHARS + 100);
    const fileMap = new Map<string, string | undefined>([['big.ts', longPatch]]);
    let capturedContent: string | undefined;
    const loop = makeMockLoop(async (opts) => {
      capturedContent = await opts.handlers['get_file_patch']!({ filename: 'big.ts' });
      const done = opts.extractDone({ approved: true, comment: 'truncated' });
      return {
        done,
        usage: { inputTokens: 10, outputTokens: 5 },
        iterations: 2,
        toolCounts: {},
        toolCallRecords: [],
      };
    });

    await runReviewLoop({ ...baseOpts, fileMap, loop });
    expect(capturedContent).toContain('... (truncated)');
    expect(capturedContent!.length).toBeLessThan(longPatch.length);
  });

  it('get_file_content calls runner.getFileContent', async () => {
    const getFileContent = vi.fn().mockResolvedValue('function foo() { return 42; }');
    const runner = { getFileContent } as unknown as CIRunner;
    let capturedContent: string | undefined;
    const loop = makeMockLoop(async (opts) => {
      capturedContent = await opts.handlers['get_file_content']!({ filename: 'src/foo.ts' });
      const done = opts.extractDone({ approved: true, comment: 'ok' });
      return {
        done,
        usage: { inputTokens: 15, outputTokens: 8 },
        iterations: 2,
        toolCounts: {},
        toolCallRecords: [],
      };
    });

    await runReviewLoop({ ...baseOpts, runner, loop });
    expect(capturedContent).toBe('function foo() { return 42; }');
    expect(getFileContent).toHaveBeenCalledWith('org', 'repo', 'src/foo.ts', 'abc123');
  });

  it('passes through toolCounts and toolCallRecords from the loop', async () => {
    const loop = makeToolThenFinishLoop('get_file_patch', { filename: 'x.ts' }, true, 'ok');
    const result = await runReviewLoop({ ...baseOpts, loop });
    expect(result.toolCounts).toEqual({ get_file_patch: 1 });
    expect(result.toolCallRecords).toEqual([{ name: 'get_file_patch', outputSize: 10 }]);
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
