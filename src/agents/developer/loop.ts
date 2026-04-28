import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ContentBlock, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages.js';
import { FerryError } from '../../lib/error.js';
import { TOOL_SCHEMAS, executeTool, type ToolName } from './tools.js';

export interface DonePayload {
  actionable: boolean;
  summary: string;
  commit_message?: string;
  branch_name?: string;
  reason_if_not_actionable?: string;
}

export interface LoopUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface LoopResult {
  done: DonePayload;
  usage: LoopUsage;
  iterations: number;
}

export async function runAgentLoop(opts: {
  anthropic: Anthropic;
  model: string;
  system: string;
  initialPrompt: string;
  repoRoot: string;
}): Promise<LoopResult> {
  const { anthropic, model, system, initialPrompt, repoRoot } = opts;
  const maxIterations = parseInt(process.env.FERRY_DEV_MAX_ITERATIONS ?? '50', 10);
  const maxInputTokens = parseInt(process.env.FERRY_DEV_MAX_INPUT_TOKENS ?? '500000', 10);
  const maxTokens = parseInt(process.env.FERRY_DEV_MAX_TOKENS ?? '2048', 10);

  // Cached system prompt + tools — static across the run, marked once.
  const systemBlocks = [
    { type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } },
  ];
  const tools = TOOL_SCHEMAS.map((t, i) =>
    i === TOOL_SCHEMAS.length - 1
      ? { ...t, cache_control: { type: 'ephemeral' as const } }
      : t,
  );

  const messages: MessageParam[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: initialPrompt, cache_control: { type: 'ephemeral' } },
      ],
    },
  ];
  const usage: LoopUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  let done: DonePayload | null = null;
  let iter = 0;

  while (iter < maxIterations) {
    iter++;

    if (usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens > maxInputTokens) {
      throw new FerryError('spend-cap', {
        reason: 'input-token-budget-exceeded',
        cap: maxInputTokens,
        consumed:
          usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
      });
    }

    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemBlocks,
      tools,
      messages,
    });

    usage.input_tokens += response.usage.input_tokens;
    usage.output_tokens += response.usage.output_tokens;
    usage.cache_creation_input_tokens += response.usage.cache_creation_input_tokens ?? 0;
    usage.cache_read_input_tokens += response.usage.cache_read_input_tokens ?? 0;
    messages.push({ role: 'assistant', content: response.content as ContentBlock[] });

    console.error(
      `[ferry:dev-loop] iter=${iter} stop_reason=${response.stop_reason} tools=${response.content.filter((b) => b.type === 'tool_use').length} in=${response.usage.input_tokens} cache_w=${response.usage.cache_creation_input_tokens ?? 0} cache_r=${response.usage.cache_read_input_tokens ?? 0} out=${response.usage.output_tokens}`,
    );

    if (response.stop_reason !== 'tool_use') {
      throw new FerryError('state-invariant', { reason: 'agent-stopped-without-done', stop_reason: response.stop_reason });
    }

    const toolResults: ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;

      if (block.name === 'done') {
        done = block.input as DonePayload;
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'ok' });
        continue;
      }

      try {
        const result = await executeTool(repoRoot, block.name as ToolName, block.input as Record<string, unknown>);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
      } catch (e) {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: (e as Error).message, is_error: true });
      }
    }

    // Mark the last tool_result as a cache breakpoint so the next turn re-uses
    // the entire conversation history from cache.
    if (toolResults.length > 0) {
      const last = toolResults[toolResults.length - 1];
      toolResults[toolResults.length - 1] = { ...last, cache_control: { type: 'ephemeral' } };
    }

    messages.push({ role: 'user', content: toolResults });

    if (done) return { done, usage, iterations: iter };
  }

  throw new FerryError('state-invariant', { reason: 'iteration-cap-exceeded', cap: maxIterations });
}
