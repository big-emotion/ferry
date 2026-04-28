import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ContentBlock } from '@anthropic-ai/sdk/resources/messages.js';
import { FerryError } from '../../lib/error.js';
import { TOOL_SCHEMAS, executeTool, type ToolName } from './tools.js';

export interface DonePayload {
  actionable: boolean;
  summary: string;
  commit_message?: string;
  branch_name?: string;
  reason_if_not_actionable?: string;
}

export interface LoopResult {
  done: DonePayload;
  usage: { input_tokens: number; output_tokens: number };
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

  const messages: MessageParam[] = [{ role: 'user', content: initialPrompt }];
  const usage = { input_tokens: 0, output_tokens: 0 };
  let done: DonePayload | null = null;
  let iter = 0;

  while (iter < maxIterations) {
    iter++;
    const response = await anthropic.messages.create({
      model,
      max_tokens: 8192,
      system,
      tools: TOOL_SCHEMAS,
      messages,
    });

    usage.input_tokens += response.usage.input_tokens;
    usage.output_tokens += response.usage.output_tokens;
    messages.push({ role: 'assistant', content: response.content as ContentBlock[] });

    console.error(`[ferry:dev-loop] iter=${iter} stop_reason=${response.stop_reason} tools=${response.content.filter((b) => b.type === 'tool_use').length}`);

    if (response.stop_reason !== 'tool_use') {
      throw new FerryError('state-invariant', { reason: 'agent-stopped-without-done', stop_reason: response.stop_reason });
    }

    const toolResults: MessageParam['content'] = [];

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

    messages.push({ role: 'user', content: toolResults });

    if (done) return { done, usage, iterations: iter };
  }

  throw new FerryError('state-invariant', { reason: 'iteration-cap-exceeded', cap: maxIterations });
}
