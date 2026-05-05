import OpenAI from 'openai';
import { FerryError } from '../../errors/index.js';
import { emitDebug } from '../debug-log.js';
import { createLogger } from '../../logger/index.js';
import type { ToolCallLoop, ToolLoopRunOpts, ToolLoopResult } from './types.js';

export function createOpenAIToolCallLoop(opts: { apiKey: string; model: string }): ToolCallLoop {
  const client = new OpenAI({ apiKey: opts.apiKey });

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

      const openaiTools: OpenAI.ChatCompletionTool[] = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema as Record<string, unknown>,
        },
      }));

      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: 'system', content: system },
        { role: 'user', content: initialPrompt },
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
        const response = await client.chat.completions.create({
          model: opts.model,
          max_tokens: maxTokens,
          messages,
          tools: openaiTools,
          tool_choice: 'required',
        });

        const choice = response.choices[0];
        if (!choice) {
          throw new FerryError('state-invariant', { reason: 'tool-loop-no-response' });
        }

        inputTokens += response.usage?.prompt_tokens ?? 0;
        outputTokens += response.usage?.completion_tokens ?? 0;

        const assistantMsg: OpenAI.ChatCompletionMessageParam = {
          role: 'assistant',
          content: choice.message.content ?? null,
          tool_calls: choice.message.tool_calls,
        };
        messages.push(assistantMsg);

        const toolCalls = choice.message.tool_calls ?? [];
        logger.info('turn', {
          iter: iter + 1,
          stop: choice.finish_reason,
          tools: toolCalls.length,
          in: response.usage?.prompt_tokens ?? 0,
          out: response.usage?.completion_tokens ?? 0,
        });
        emitDebug(
          {
            type: 'turn',
            iter: iter + 1,
            depth: 0,
            stop_reason: choice.finish_reason ?? 'unknown',
            tools: toolCalls.length,
            mcp_tools: 0,
            in: response.usage?.prompt_tokens ?? 0,
            cache_w: 0,
            cache_r: 0,
            out: response.usage?.completion_tokens ?? 0,
            elapsed_ms: Date.now() - iterStart,
          },
          logger,
        );

        if (choice.finish_reason !== 'tool_calls') {
          throw new FerryError('state-invariant', {
            reason: 'tool-loop-stopped-without-finish',
            stop_reason: choice.finish_reason,
          });
        }

        for (const toolCall of toolCalls) {
          if (toolCall.type !== 'function') continue;

          let input: Record<string, unknown>;
          try {
            input = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
          } catch {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: 'invalid JSON arguments',
            });
            continue;
          }

          if (toolCall.function.name === finishTool) {
            done = extractDone(input);
            messages.push({ role: 'tool', tool_call_id: toolCall.id, content: 'ok' });
            continue;
          }

          const handler = handlers[toolCall.function.name];
          if (handler) {
            const result = await handler(input);
            trackTool(toolCall.function.name, result.length);
            messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
          } else {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `unknown tool: ${toolCall.function.name}`,
            });
          }
        }

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
