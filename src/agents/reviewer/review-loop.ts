import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ToolResultBlockParam,
  ContentBlock,
} from '@anthropic-ai/sdk/resources/messages.js';
import type { CIRunner, PRFile } from '../../lib/dispatch/runner/types.js';
import { FerryError } from '../../lib/errors/index.js';
import { emitDebug } from '../../lib/llm/debug-log.js';
import { createLogger } from '../../lib/logger/index.js';
import type { Logger } from '../../lib/logger/index.js';
import type { CiStatus } from './ci-gate.js';

export const MAX_PATCH_CHARS = 20_000;
export const MAX_CONTENT_CHARS = 40_000;
const MAX_ITERATIONS = 40;

export type { CiStatus, PRFile as PrFile };

export const REVIEW_TOOLS: Anthropic.Tool[] = [
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
  anthropic: Anthropic;
  model: string;
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
  const { anthropic, model, system, initialPrompt, fileMap, runner, owner, repo, headSha } = opts;
  const logger = opts.logger ?? createLogger('', 'ferry:review-loop');
  const maxIterations =
    opts.maxIterations ??
    (parseInt(process.env.FERRY_REVIEWER_MAX_ITERATIONS ?? '', 10) || MAX_ITERATIONS);
  const maxTokens =
    opts.maxTokens ?? (parseInt(process.env.FERRY_REVIEWER_MAX_TOKENS ?? '', 10) || 16384);

  const tools = REVIEW_TOOLS.map((t, i) =>
    i === REVIEW_TOOLS.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t,
  );

  const messages: MessageParam[] = [
    {
      role: 'user',
      content: [{ type: 'text', text: initialPrompt, cache_control: { type: 'ephemeral' } }],
    },
  ];

  let inputTokens = 0;
  let outputTokens = 0;
  let result: ReviewResult | null = null;
  const toolCounts: Record<string, number> = {};
  const toolCallRecords: Array<{ name: string; outputSize: number }> = [];
  function trackTool(name: string, outputSize: number): void {
    toolCounts[name] = (toolCounts[name] ?? 0) + 1;
    toolCallRecords.push({ name, outputSize });
  }
  const loopStart = Date.now();

  for (let iter = 0; iter < maxIterations; iter++) {
    const iterStart = Date.now();
    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools,
      messages,
    });

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    messages.push({ role: 'assistant', content: response.content as ContentBlock[] });

    const toolCount = response.content.filter((b) => b.type === 'tool_use').length;
    logger.info('turn', {
      iter: iter + 1,
      stop: response.stop_reason,
      tools: toolCount,
      in: response.usage.input_tokens,
      out: response.usage.output_tokens,
    });
    emitDebug(
      {
        type: 'turn',
        iter: iter + 1,
        depth: 0,
        stop_reason: response.stop_reason ?? 'unknown',
        tools: toolCount,
        mcp_tools: 0,
        in: response.usage.input_tokens,
        cache_w: 0,
        cache_r: 0,
        out: response.usage.output_tokens,
        elapsed_ms: Date.now() - iterStart,
      },
      logger,
    );

    if (response.stop_reason !== 'tool_use') {
      throw new FerryError('state-invariant', {
        reason: 'reviewer-stopped-without-finish',
        stop_reason: response.stop_reason,
      });
    }

    const toolResults: ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const input = block.input as Record<string, unknown>;

      if (block.name === 'finish_review') {
        result = {
          approved: input.approved as boolean,
          comment: input.comment as string,
        };
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'ok' });
        continue;
      }

      if (block.name === 'get_file_patch') {
        const filename = input.filename as string;
        logger.info('tool', { iter: iter + 1, tool: 'get_file_patch', file: filename });
        const patch = fileMap.get(filename);
        let content: string;
        if (patch === undefined) {
          content = `(file not found in PR: ${filename})`;
        } else if (!patch) {
          content = '(no patch — binary, empty, or content unchanged)';
        } else {
          const patchLimit =
            parseInt(process.env.FERRY_REVIEW_PATCH_TRUNCATE_CHARS ?? '', 10) || MAX_PATCH_CHARS;
          content =
            patch.length > patchLimit ? patch.slice(0, patchLimit) + '\n... (truncated)' : patch;
        }
        trackTool('get_file_patch', content.length);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
        continue;
      }

      if (block.name === 'get_file_content') {
        const filename = input.filename as string;
        logger.info('tool', { iter: iter + 1, tool: 'get_file_content', file: filename });
        const fileLimit =
          parseInt(process.env.FERRY_REVIEW_FILE_TRUNCATE_CHARS ?? '', 10) || MAX_CONTENT_CHARS;
        const rawContent = await runner.getFileContent(owner, repo, filename, headSha);
        const content =
          rawContent.length > fileLimit
            ? rawContent.slice(0, fileLimit) + '\n... (truncated)'
            : rawContent;
        trackTool('get_file_content', content.length);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
        continue;
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: `unknown tool: ${block.name}`,
        is_error: true,
      });
    }

    // Roll cache breakpoint forward to the latest tool results
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        const content = msg.content as ToolResultBlockParam[];
        if (content.some((b) => b.type === 'tool_result')) {
          const entry = { ...content[content.length - 1] } as ToolResultBlockParam & {
            cache_control?: unknown;
          };
          delete entry.cache_control;
          content[content.length - 1] = entry as ToolResultBlockParam;
          break;
        }
      }
    }
    if (toolResults.length > 0) {
      const last = toolResults[toolResults.length - 1];
      toolResults[toolResults.length - 1] = { ...last, cache_control: { type: 'ephemeral' } };
    }

    messages.push({ role: 'user', content: toolResults });

    if (result) {
      emitDebug(
        {
          type: 'result',
          subtype: 'success',
          iterations: iter + 1,
          total_in: inputTokens,
          total_out: outputTokens,
          elapsed_ms: Date.now() - loopStart,
        },
        logger,
      );
      return {
        result,
        inputTokens,
        outputTokens,
        iterations: iter + 1,
        toolCounts,
        toolCallRecords,
      };
    }
  }

  throw new FerryError('state-invariant', {
    reason: 'review-iteration-cap-exceeded',
    cap: MAX_ITERATIONS,
  });
}
