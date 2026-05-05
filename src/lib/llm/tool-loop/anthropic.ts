import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ToolResultBlockParam,
  ContentBlock,
} from '@anthropic-ai/sdk/resources/messages.js';
import { FerryError } from '../../errors/index.js';
import { emitDebug } from '../debug-log.js';
import { createLogger } from '../../logger/index.js';
import type { ToolCallLoop, ToolLoopRunOpts, ToolLoopResult } from './types.js';

export function createAnthropicToolCallLoop(opts: {
  client: Anthropic;
  model: string;
}): ToolCallLoop {
  return {
    async run<T>(runOpts: ToolLoopRunOpts<T>): Promise<ToolLoopResult<T>> {
      const {
        system,
        initialPrompt,
        tools,
        handlers,
        finishTool,
        extractDone,
        maxIterations,
        maxTokens,
      } = runOpts;
      const logger = runOpts.logger ?? createLogger('', 'ferry:tool-loop');

      // Add cache_control to the last tool for Anthropic prompt-caching.
      const anthropicTools = tools.map((t, i) =>
        i === tools.length - 1
          ? ({ ...t, cache_control: { type: 'ephemeral' } } as Anthropic.Tool)
          : (t as Anthropic.Tool),
      );

      const messages: MessageParam[] = [
        {
          role: 'user',
          content: [{ type: 'text', text: initialPrompt, cache_control: { type: 'ephemeral' } }],
        },
      ];

      let inputTokens = 0;
      let outputTokens = 0;
      let done: T | null = null;
      const toolCounts: Record<string, number> = {};
      const toolCallRecords: Array<{ name: string; outputSize: number }> = [];

      function trackTool(name: string, outputSize: number): void {
        toolCounts[name] = (toolCounts[name] ?? 0) + 1;
        toolCallRecords.push({ name, outputSize });
      }

      const loopStart = Date.now();

      for (let iter = 0; iter < maxIterations; iter++) {
        const iterStart = Date.now();
        const response = await opts.client.messages.create({
          model: opts.model,
          max_tokens: maxTokens,
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          tools: anthropicTools,
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
            reason: 'tool-loop-stopped-without-finish',
            stop_reason: response.stop_reason,
          });
        }

        const toolResults: ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          const input = block.input as Record<string, unknown>;

          if (block.name === finishTool) {
            done = extractDone(input);
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'ok' });
            continue;
          }

          const handler = handlers[block.name];
          if (handler) {
            const result = await handler(input);
            trackTool(block.name, result.length);
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
          } else {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: `unknown tool: ${block.name}`,
              is_error: true,
            });
          }
        }

        // Roll cache breakpoint forward to the most recent tool results.
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

        if (done !== null) {
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
            done,
            usage: { inputTokens, outputTokens },
            iterations: iter + 1,
            toolCounts,
            toolCallRecords,
          };
        }
      }

      throw new FerryError('state-invariant', {
        reason: 'tool-loop-iteration-cap-exceeded',
        cap: maxIterations,
      });
    },
  };
}
