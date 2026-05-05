import type { CIRunner, PRFile } from '../../lib/dispatch/runner/types.js';
import { createLogger } from '../../lib/logger/index.js';
import type { Logger } from '../../lib/logger/index.js';
import type { CiStatus } from './ci-gate.js';
import type { ToolCallLoop, ToolDef } from '../../lib/llm/tool-loop/index.js';

export const MAX_PATCH_CHARS = 20_000;
export const MAX_CONTENT_CHARS = 40_000;
const MAX_ITERATIONS = 40;

export type { CiStatus, PRFile as PrFile };

export const REVIEW_TOOL_DEFS: ToolDef[] = [
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
    name: 'finish_review',
    description:
      'Post the review verdict and end the review loop. Call once you have inspected all relevant files.',
    input_schema: {
      type: 'object',
      properties: {
        approved: {
          type: 'boolean',
          description: 'true = ready to merge, false = changes required.',
        },
        comment: {
          type: 'string',
          description:
            'Full review comment in Markdown. Follow the required format from the system prompt.',
        },
      },
      required: ['approved', 'comment'],
    },
  },
];

export interface ReviewResult {
  approved: boolean;
  comment: string;
}

export function detectMergeConflicts(files: PRFile[]): string[] {
  const conflicted: string[] = [];
  for (const f of files) {
    if (f.patch && /^[+].*<{7}|^[+].*={7}|^[+].*>{7}/m.test(f.patch)) {
      conflicted.push(f.filename);
    }
  }
  return conflicted;
}

export function buildFileList(files: PRFile[]): string {
  return files
    .map((f) => `${f.status.padEnd(8)} +${f.additions} -${f.deletions}  ${f.filename}`)
    .join('\n');
}

export async function runReviewLoop(opts: {
  loop: ToolCallLoop;
  system: string;
  initialPrompt: string;
  fileMap: Map<string, string | undefined>;
  runner: CIRunner;
  owner: string;
  repo: string;
  headSha: string;
  maxIterations?: number;
  maxTokens?: number;
  logger?: Logger;
}): Promise<{
  result: ReviewResult;
  inputTokens: number;
  outputTokens: number;
  iterations: number;
  toolCounts: Record<string, number>;
  toolCallRecords: Array<{ name: string; outputSize: number }>;
}> {
  const { loop, system, initialPrompt, fileMap, runner, owner, repo, headSha } = opts;
  const logger = opts.logger ?? createLogger('', 'ferry:review-loop');
  const maxIterations =
    opts.maxIterations ??
    (parseInt(process.env.FERRY_REVIEWER_MAX_ITERATIONS ?? '', 10) || MAX_ITERATIONS);
  const maxTokens =
    opts.maxTokens ?? (parseInt(process.env.FERRY_REVIEWER_MAX_TOKENS ?? '', 10) || 16384);

  const {
    done: result,
    usage,
    iterations,
    toolCounts,
    toolCallRecords,
  } = await loop.run<ReviewResult>({
    system,
    initialPrompt,
    tools: REVIEW_TOOL_DEFS,
    finishTool: 'finish_review',
    extractDone: (input) => ({
      approved: input.approved as boolean,
      comment: input.comment as string,
    }),
    handlers: {
      get_file_patch: (input) => {
        const filename = input.filename as string;
        logger.info('tool', { tool: 'get_file_patch', file: filename });
        const patch = fileMap.get(filename);
        if (patch === undefined) return `(file not found in PR: ${filename})`;
        if (!patch) return '(no patch — binary, empty, or content unchanged)';
        const patchLimit =
          parseInt(process.env.FERRY_REVIEW_PATCH_TRUNCATE_CHARS ?? '', 10) || MAX_PATCH_CHARS;
        return patch.length > patchLimit ? patch.slice(0, patchLimit) + '\n... (truncated)' : patch;
      },
      get_file_content: async (input) => {
        const filename = input.filename as string;
        logger.info('tool', { tool: 'get_file_content', file: filename });
        const fileLimit =
          parseInt(process.env.FERRY_REVIEW_FILE_TRUNCATE_CHARS ?? '', 10) || MAX_CONTENT_CHARS;
        const rawContent = await runner.getFileContent(owner, repo, filename, headSha);
        return rawContent.length > fileLimit
          ? rawContent.slice(0, fileLimit) + '\n... (truncated)'
          : rawContent;
      },
    },
    maxIterations,
    maxTokens,
    logger,
  });

  return {
    result,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    iterations,
    toolCounts,
    toolCallRecords,
  };
}
