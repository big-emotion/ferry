import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  runReviewLoop,
  detectMergeConflicts,
  buildFileList,
  makeReviewExecuteTool,
  MAX_PATCH_CHARS,
} from './review-loop.js';
import type { PrFile } from './review-loop.js';
import type { CIRunner } from '../../lib/dispatch/runner/types.js';
import type { AgentLoop, AgentLoopResult } from '../../lib/llm/agent-loop/index.js';

function makeAgentLoopResult(
  approved: boolean,
  comment: string,
  overrides: Partial<AgentLoopResult> = {},
): AgentLoopResult {
  return {
    done: {
      actionable: approved,
      approved,
      summary: comment,
      comment,
    } as unknown as AgentLoopResult['done'],
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    iterations: 1,
    toolCounts: {},
    toolCallRecords: [],
    ...overrides,
  };
}

function makeAgentLoop(result: AgentLoopResult): AgentLoop {
  return { run: vi.fn().mockResolvedValue(result) };
}

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const baseOpts = {
  system: 'sys',
  initialPrompt: 'review this',
  repoRoot: '/repo',
  branchName: 'ferry/PROJ-1',
};

describe('runReviewLoop', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('completes when done is called with approved=true', async () => {
    const loop = makeAgentLoop(makeAgentLoopResult(true, 'LGTM'));
    const result = await runReviewLoop({ ...baseOpts, loop });
    expect(result.result.approved).toBe(true);
    expect(result.result.comment).toBe('LGTM');
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
  });

  it('completes when done is called with approved=false', async () => {
    const loop = makeAgentLoop(makeAgentLoopResult(false, 'needs work'));
    const result = await runReviewLoop({ ...baseOpts, loop });
    expect(result.result.approved).toBe(false);
    expect(result.result.comment).toBe('needs work');
  });

  it('returns correct iteration count', async () => {
    const loopResult = makeAgentLoopResult(true, 'ok', { iterations: 3 });
    const loop = makeAgentLoop(loopResult);
    const result = await runReviewLoop({ ...baseOpts, loop });
    expect(result.iterations).toBe(3);
  });

  it('passes tools, repoRoot, branchName, secretScan to loop.run', async () => {
    const loop = makeAgentLoop(makeAgentLoopResult(true, 'ok'));
    await runReviewLoop({ ...baseOpts, loop });
    const runOpts = (loop.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(runOpts.repoRoot).toBe('/repo');
    expect(runOpts.branchName).toBe('ferry/PROJ-1');
    expect(typeof runOpts.secretScan).toBe('function');
    expect(runOpts.tools).toBeDefined();
    expect(runOpts.tools.some((t: { name: string }) => t.name === 'get_file_patch')).toBe(true);
    expect(runOpts.tools.some((t: { name: string }) => t.name === 'get_file_content')).toBe(true);
    expect(runOpts.tools.some((t: { name: string }) => t.name === 'done')).toBe(true);
  });

  it('passes mcpServers to loop.run when provided', async () => {
    const mcpServers = [{ name: 'atlassian', url: 'https://mcp.atlassian.com' }];
    const loop = makeAgentLoop(makeAgentLoopResult(true, 'ok'));
    await runReviewLoop({ ...baseOpts, loop, mcpServers });
    const runOpts = (loop.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(runOpts.mcpServers).toEqual(mcpServers);
  });

  it('passes empty mcpServers when not provided', async () => {
    const loop = makeAgentLoop(makeAgentLoopResult(true, 'ok'));
    await runReviewLoop({ ...baseOpts, loop });
    const runOpts = (loop.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(runOpts.mcpServers).toEqual([]);
  });

  it('passes through toolCounts and toolCallRecords from the loop', async () => {
    const loopResult = makeAgentLoopResult(true, 'ok', {
      toolCounts: { get_file_patch: 2 },
      toolCallRecords: [{ name: 'get_file_patch', outputSize: 500 }],
    });
    const loop = makeAgentLoop(loopResult);
    const result = await runReviewLoop({ ...baseOpts, loop });
    expect(result.toolCounts).toEqual({ get_file_patch: 2 });
    expect(result.toolCallRecords).toEqual([{ name: 'get_file_patch', outputSize: 500 }]);
  });
});

describe('makeReviewExecuteTool', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('get_file_patch returns patch from fileMap', async () => {
    const fileMap = new Map<string, string | undefined>([
      ['src/auth.ts', '+export function login() {}'],
    ]);
    const executeTool = makeReviewExecuteTool({
      fileMap,
      runner: {} as unknown as CIRunner,
      owner: 'org',
      repo: 'repo',
      headSha: 'abc123',
      logger: noopLogger as never,
    });
    const result = await executeTool('/repo', 'get_file_patch', { filename: 'src/auth.ts' });
    expect(result).toBe('+export function login() {}');
  });

  it('get_file_patch returns not-found message for missing file', async () => {
    const fileMap = new Map<string, string | undefined>();
    const executeTool = makeReviewExecuteTool({
      fileMap,
      runner: {} as unknown as CIRunner,
      owner: 'org',
      repo: 'repo',
      headSha: 'abc123',
      logger: noopLogger as never,
    });
    const result = await executeTool('/repo', 'get_file_patch', { filename: 'missing.ts' });
    expect(result).toContain('(file not found in PR: missing.ts)');
  });

  it('get_file_patch returns no-patch message for empty string', async () => {
    const fileMap = new Map<string, string | undefined>([['binary.png', '']]);
    const executeTool = makeReviewExecuteTool({
      fileMap,
      runner: {} as unknown as CIRunner,
      owner: 'org',
      repo: 'repo',
      headSha: 'abc123',
      logger: noopLogger as never,
    });
    const result = await executeTool('/repo', 'get_file_patch', { filename: 'binary.png' });
    expect(result).toBe('(no patch — binary, empty, or content unchanged)');
  });

  it('truncates patch when it exceeds MAX_PATCH_CHARS', async () => {
    const longPatch = '+' + 'x'.repeat(MAX_PATCH_CHARS + 100);
    const fileMap = new Map<string, string | undefined>([['big.ts', longPatch]]);
    const executeTool = makeReviewExecuteTool({
      fileMap,
      runner: {} as unknown as CIRunner,
      owner: 'org',
      repo: 'repo',
      headSha: 'abc123',
      logger: noopLogger as never,
    });
    const result = await executeTool('/repo', 'get_file_patch', { filename: 'big.ts' });
    expect(result).toContain('... (truncated)');
    expect(result.length).toBeLessThan(longPatch.length);
  });

  it('get_file_content calls runner.getFileContent', async () => {
    const getFileContent = vi.fn().mockResolvedValue('function foo() { return 42; }');
    const runner = { getFileContent } as unknown as CIRunner;
    const fileMap = new Map<string, string | undefined>();
    const executeTool = makeReviewExecuteTool({
      fileMap,
      runner,
      owner: 'org',
      repo: 'repo',
      headSha: 'abc123',
      logger: noopLogger as never,
    });
    const result = await executeTool('/repo', 'get_file_content', { filename: 'src/foo.ts' });
    expect(result).toBe('function foo() { return 42; }');
    expect(getFileContent).toHaveBeenCalledWith('org', 'repo', 'src/foo.ts', 'abc123');
  });

  it('throws for unknown tool name', async () => {
    const executeTool = makeReviewExecuteTool({
      fileMap: new Map(),
      runner: {} as unknown as CIRunner,
      owner: 'org',
      repo: 'repo',
      headSha: 'abc123',
      logger: noopLogger as never,
    });
    await expect(executeTool('/repo', 'unknown_tool', {})).rejects.toThrow('Unknown reviewer tool');
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
