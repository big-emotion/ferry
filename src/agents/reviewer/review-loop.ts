import type { CIRunner, PRFile } from '../../lib/dispatch/runner/types.js';
import type { Logger } from '../../lib/logger/index.js';
import type { CiStatus } from './ci-gate.js';
import type { AgentLoop, AgentTool, McpServerConfig } from '../../lib/llm/agent-loop/index.js';

export const MAX_PATCH_CHARS = 20_000;
export const MAX_CONTENT_CHARS = 40_000;

export type { CiStatus, PRFile as PrFile };

export const REVIEW_TOOL_DEFS: AgentTool[] = [
  {
    name: 'get_file_patch',
    description:
      'Get the unified diff patch for a specific file in this PR. ' +
      'Use this to inspect what changed in a file before making a finding.',
    input_schema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Exact file path as listed in the PR file list.' },
      },
      required: ['filename'],
    },
  },
  {
    name: 'get_file_content',
    description:
      'Get the full content of a file from the PR head branch. ' +
      'Use when the patch is truncated or you need context outside the changed lines.',
    input_schema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Exact file path.' },
      },
      required: ['filename'],
    },
  },
  {
    name: 'done',
    description:
      'Post the review verdict and end the review loop. Call once you have inspected all relevant files.',
    input_schema: {
      type: 'object',
      properties: {
        actionable: {
          type: 'boolean',
          description: 'true if you are approving the PR, false if requesting changes.',
        },
        approved: {
          type: 'boolean',
          description: 'true = ready to merge, false = changes required.',
        },
        summary: {
          type: 'string',
          description: 'One sentence summary of the review outcome.',
        },
        comment: {
          type: 'string',
          description:
            'Full review comment in Markdown. Follow the required format from the system prompt.',
        },
      },
      required: ['actionable', 'approved', 'summary', 'comment'],
    },
  },
];

export interface ReviewResult {
  approved: boolean;
  comment: string;
}

// The implementations of detectMergeConflicts and buildFileList live in
// `src/lib/agent-runtime/reviewer-helpers.ts` so the lib layer's
// reviewer-prepare can depend on them without inverting the
// agents/** → lib/** layering. Re-exported here so existing import paths
// under src/agents/reviewer/** stay valid.
export { detectMergeConflicts, buildFileList } from '../../lib/agent-runtime/reviewer-helpers.js';

/**
 * Factory that returns the reviewer's executeTool function.
 * Handles get_file_patch and get_file_content; the done tool is handled
 * by the agent loop internally.
 */
export function makeReviewExecuteTool(opts: {
  fileMap: Map<string, string | undefined>;
  runner: CIRunner;
  owner: string;
  repo: string;
  headSha: string;
  logger: Logger;
}): (repoRoot: string, name: string, input: Record<string, unknown>) => Promise<string> {
  const { fileMap, runner, owner, repo, headSha, logger } = opts;

  return async (
    _repoRoot: string,
    name: string,
    input: Record<string, unknown>,
  ): Promise<string> => {
    if (name === 'get_file_patch') {
      const filename = input.filename as string;
      logger.info('tool', { tool: 'get_file_patch', file: filename });
      const patch = fileMap.get(filename);
      if (patch === undefined) return `(file not found in PR: ${filename})`;
      if (!patch) return '(no patch — binary, empty, or content unchanged)';
      const patchLimit =
        parseInt(process.env.FERRY_REVIEW_PATCH_TRUNCATE_CHARS ?? '', 10) || MAX_PATCH_CHARS;
      return patch.length > patchLimit ? patch.slice(0, patchLimit) + '\n... (truncated)' : patch;
    }
    if (name === 'get_file_content') {
      const filename = input.filename as string;
      logger.info('tool', { tool: 'get_file_content', file: filename });
      const fileLimit =
        parseInt(process.env.FERRY_REVIEW_FILE_TRUNCATE_CHARS ?? '', 10) || MAX_CONTENT_CHARS;
      const rawContent = await runner.getFileContent(owner, repo, filename, headSha);
      return rawContent.length > fileLimit
        ? rawContent.slice(0, fileLimit) + '\n... (truncated)'
        : rawContent;
    }
    throw new Error(`Unknown reviewer tool: ${name}`);
  };
}

export async function runReviewLoop(opts: {
  loop: AgentLoop;
  system: string;
  initialPrompt: string;
  repoRoot: string;
  branchName: string;
  mcpServers?: McpServerConfig[];
  logger?: Logger;
}): Promise<{
  result: ReviewResult;
  inputTokens: number;
  outputTokens: number;
  iterations: number;
  toolCounts: Record<string, number>;
  toolCallRecords: Array<{ name: string; outputSize: number }>;
}> {
  const { loop, system, initialPrompt, repoRoot, branchName } = opts;
  const mcpServers = opts.mcpServers ?? [];

  const loopResult = await loop.run({
    system,
    initialPrompt,
    tools: REVIEW_TOOL_DEFS,
    repoRoot,
    branchName,
    secretScan: () => Promise.resolve(),
    mcpServers,
  });

  const done = loopResult.done as unknown as {
    approved: boolean;
    comment: string;
  };

  const result: ReviewResult = {
    approved: done.approved,
    comment: done.comment,
  };

  return {
    result,
    inputTokens: loopResult.usage.input_tokens,
    outputTokens: loopResult.usage.output_tokens,
    iterations: loopResult.iterations,
    toolCounts: loopResult.toolCounts,
    toolCallRecords: loopResult.toolCallRecords,
  };
}
