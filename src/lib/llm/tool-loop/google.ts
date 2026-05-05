import { GoogleGenAI } from '@google/genai';
import type { Content, Part, Tool } from '@google/genai';
import { FerryError } from '../../errors/index.js';
import { emitDebug } from '../debug-log.js';
import { createLogger } from '../../logger/index.js';
import type { ToolCallLoop, ToolLoopRunOpts, ToolLoopResult, ToolDef } from './types.js';

function toGoogleTools(tools: ToolDef[]): Tool[] {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parametersJsonSchema: t.input_schema,
      })),
    },
  ];
}

export function createGoogleToolCallLoop(opts: { apiKey: string; model: string }): ToolCallLoop {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });

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

      const googleTools = toGoogleTools(tools);
      const contents: Content[] = [{ role: 'user', parts: [{ text: initialPrompt }] }];

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
        const response = await ai.models.generateContent({
          model: opts.model,
          contents,
          config: {
            systemInstruction: system,
            tools: googleTools,
            maxOutputTokens: maxTokens,
          },
        });

        inputTokens += response.usageMetadata?.promptTokenCount ?? 0;
        outputTokens += response.usageMetadata?.candidatesTokenCount ?? 0;

        const fnCalls = response.functionCalls ?? [];

        // Append the model's turn to history using the raw candidate content.
        const modelParts = response.candidates?.[0]?.content?.parts ?? [];
        if (modelParts.length > 0) {
          contents.push({ role: 'model', parts: modelParts });
        }

        logger.info('turn', {
          iter: iter + 1,
          tools: fnCalls.length,
          in: response.usageMetadata?.promptTokenCount ?? 0,
          out: response.usageMetadata?.candidatesTokenCount ?? 0,
        });
        emitDebug(
          {
            type: 'turn',
            iter: iter + 1,
            depth: 0,
            stop_reason: fnCalls.length > 0 ? 'tool_use' : 'end_turn',
            tools: fnCalls.length,
            mcp_tools: 0,
            in: response.usageMetadata?.promptTokenCount ?? 0,
            cache_w: 0,
            cache_r: 0,
            out: response.usageMetadata?.candidatesTokenCount ?? 0,
            elapsed_ms: Date.now() - iterStart,
          },
          logger,
        );

        if (fnCalls.length === 0) {
          throw new FerryError('state-invariant', {
            reason: 'tool-loop-stopped-without-finish',
            stop_reason: 'end_turn',
          });
        }

        const responseParts: Part[] = [];

        for (const fc of fnCalls) {
          const name = fc.name ?? '';
          const input = (fc.args ?? {}) as Record<string, unknown>;

          if (name === finishTool) {
            done = extractDone(input);
            responseParts.push({
              functionResponse: { name, response: { result: 'ok' } },
            });
            continue;
          }

          const handler = handlers[name];
          if (handler) {
            const result = await handler(input);
            trackTool(name, result.length);
            responseParts.push({
              functionResponse: { name, response: { result } },
            });
          } else {
            responseParts.push({
              functionResponse: { name, response: { error: `unknown tool: ${name}` } },
            });
          }
        }

        contents.push({ role: 'user', parts: responseParts });

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
