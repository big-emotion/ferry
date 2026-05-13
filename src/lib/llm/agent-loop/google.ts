import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai';
import type { Content, Part } from '@google/genai';
import { FerryError } from '../../errors/index.js';
import { computeCostEur } from '../pricing.js';
import { emitDebug } from '../debug-log.js';
import { McpClientPool } from '../../mcp/pool.js';
import { createLogger } from '../../logger/index.js';
import type { Logger } from '../../logger/index.js';
import type {
  AgentTool,
  AgentLoop,
  AgentLoopResult,
  AgentLoopUsage,
  DonePayload,
  DoneOutcome,
  McpServerConfig,
  StdioMcpServerConfig,
  ToolCallRecord,
} from './types.js';
import { isStdioMcpServer, isHttpMcpServer } from './types.js';

const COMMIT_AND_STOP_TOOL_NAMES = new Set([
  'bash',
  'write_file',
  'str_replace',
  'commit_progress',
  'done',
]);

const KEEP_LAST_TURNS = 6;
const STUB = '[truncated: tool result elided to save context]';

type ToolExecutor = (
  repoRoot: string,
  name: string,
  input: Record<string, unknown>,
) => Promise<string>;
type CommitProgressHandler = (
  repoRoot: string,
  branchName: string,
  message: string,
  secretScan: () => Promise<void>,
) => Promise<string>;

function pruneMessageHistory(messages: Content[]): void {
  // Collect indices of user messages that contain functionResponse parts.
  const toolResultIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'user' && msg.parts?.some((p) => p.functionResponse !== undefined)) {
      toolResultIndices.push(i);
    }
  }

  // messages[0] is the initial user prompt — never prune it.
  const cutoff = messages.length - KEEP_LAST_TURNS * 2;
  if (cutoff <= 1) return;

  for (const idx of toolResultIndices) {
    if (idx >= cutoff) break;
    const msg = messages[idx];
    if (!msg.parts) continue;
    for (let j = 0; j < msg.parts.length; j++) {
      const part = msg.parts[j];
      if (part.functionResponse === undefined) continue;
      const output = part.functionResponse.response?.['output'];
      if (typeof output === 'string' && output !== STUB) {
        msg.parts[j] = {
          functionResponse: {
            name: part.functionResponse.name,
            id: part.functionResponse.id,
            response: { output: STUB },
          },
        };
      }
    }
  }
}

function injectBudgetWarning(messages: Content[], text: string): void {
  const last = messages[messages.length - 1];
  if (last?.role === 'user') {
    last.parts = [...(last.parts ?? []), { text }];
  } else {
    messages.push({ role: 'user', parts: [{ text }] });
  }
}

function compactOldToolResults(messages: Content[], windowTurns: number): void {
  const toolResultIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'user' && msg.parts?.some((p) => p.functionResponse !== undefined)) {
      toolResultIndices.push(i);
    }
  }

  if (toolResultIndices.length <= windowTurns) return;

  const compactCount = toolResultIndices.length - windowTurns;
  for (let k = 0; k < compactCount; k++) {
    const idx = toolResultIndices[k];
    const msg = messages[idx];
    if (!msg.parts) continue;
    for (let j = 0; j < msg.parts.length; j++) {
      const part = msg.parts[j];
      if (part.functionResponse === undefined) continue;
      const output = part.functionResponse.response?.['output'];
      if (typeof output !== 'string' || output.startsWith('[compacted')) continue;
      const tokens = Math.ceil(output.length / 4);
      msg.parts[j] = {
        functionResponse: {
          name: part.functionResponse.name,
          id: part.functionResponse.id,
          response: { output: `[compacted — ~${tokens} tokens elided]` },
        },
      };
    }
  }
}

export function createGoogleAgentLoop(opts: {
  apiKey?: string;
  model: string;
  ai?: GoogleGenAI;
  executeTool: ToolExecutor;
  commitProgress?: CommitProgressHandler;
  maxIterations?: number;
  maxInputTokens?: number;
  maxTokens?: number;
  maxCostEur?: number;
  compactWindow?: number;
  logger?: Logger;
}): AgentLoop {
  const ai = opts.ai ?? new GoogleGenAI({ apiKey: opts.apiKey });
  const logger = opts.logger ?? createLogger('', 'ferry:dev-loop');

  async function runLoop(input: {
    system: string;
    initialPrompt: string;
    tools: AgentTool[];
    repoRoot: string;
    branchName: string;
    secretScan: () => Promise<void>;
    mcpServers?: McpServerConfig[];
  }): Promise<AgentLoopResult> {
    const { system, initialPrompt, tools, repoRoot, branchName, secretScan } = input;
    const maxIterations =
      opts.maxIterations ?? parseInt(process.env.FERRY_DEV_MAX_ITERATIONS ?? '200', 10);
    const maxInputTokens =
      opts.maxInputTokens ?? parseInt(process.env.FERRY_DEV_MAX_INPUT_TOKENS ?? '500000', 10);
    const maxTokens = opts.maxTokens ?? parseInt(process.env.FERRY_DEV_MAX_TOKENS ?? '16384', 10);
    const maxCostEur = opts.maxCostEur;
    const compactWindow =
      opts.compactWindow ?? parseInt(process.env.FERRY_DEV_COMPACT_WINDOW ?? '8', 10);

    const allServers = input.mcpServers ?? [];
    const httpServers = allServers.filter((s) => isHttpMcpServer(s) && 'url' in s);
    if (httpServers.length > 0) {
      throw new FerryError('state-invariant', {
        reason: 'http-mcp-unsupported',
        provider: 'google',
        detail:
          'HTTP MCP servers are only supported with the Anthropic provider. Configure stdio MCP servers or switch to provider: anthropic.',
      });
    }
    const stdioServers = allServers.filter((s): s is StdioMcpServerConfig => isStdioMcpServer(s));

    const pool = new McpClientPool();
    try {
      if (stdioServers.length > 0) {
        await pool.connect(stdioServers);
        if (pool.getTools().length > 0) {
          logger.info('stdio_mcp_tools', {
            count: pool.getTools().length,
            servers: stdioServers.map((s) => s.name).join(','),
          });
        }
      }

      const nativeAndStdioTools = [...tools, ...pool.getTools()];
      const allToolDeclarations = nativeAndStdioTools.map((t) => ({
        name: t.name,
        description: t.description,
        parametersJsonSchema: t.input_schema,
      }));

      const messages: Content[] = [{ role: 'user', parts: [{ text: initialPrompt }] }];

      const usage: AgentLoopUsage = {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };
      const toolCounts: Record<string, number> = {};
      const toolCallRecords: ToolCallRecord[] = [];
      function trackTool(name: string, outputSize: number): void {
        toolCounts[name] = (toolCounts[name] ?? 0) + 1;
        toolCallRecords.push({ name, outputSize });
      }
      let done: DonePayload | null = null;
      let iter = 0;
      const loopStart = Date.now();
      let warned70 = false;
      let warned85 = false;

      while (iter < maxIterations) {
        iter++;
        const iterStart = Date.now();

        const billableEquiv = usage.input_tokens + usage.output_tokens;
        if (billableEquiv > maxInputTokens) {
          throw new FerryError('spend-cap', {
            reason: 'input-token-budget-exceeded',
            cap: maxInputTokens,
            consumed: billableEquiv,
          });
        }

        if (maxCostEur !== undefined) {
          const costEur = computeCostEur(
            'google',
            opts.model,
            usage.input_tokens,
            usage.output_tokens,
          );
          if (costEur >= maxCostEur) {
            throw new FerryError('spend-cap', {
              reason: 'eur-budget-exceeded',
              cap: maxCostEur,
              consumed: costEur,
            });
          }
        }

        const budgetFraction = maxInputTokens > 0 ? billableEquiv / maxInputTokens : 0;

        if (!warned70 && budgetFraction >= 0.7) {
          warned70 = true;
          const remaining = Math.round((1 - budgetFraction) * 100);
          logger.info('budget_warning', { iter, threshold: 70, remaining_pct: remaining });
          injectBudgetWarning(
            messages,
            `[ferry] You have used ~${Math.round(budgetFraction * 100)}% of your input budget (${remaining}% remaining). ` +
              `Wrap up now: stop exploration, finish the current change, commit, and push.`,
          );
        }

        if (!warned85 && budgetFraction >= 0.85) {
          warned85 = true;
          logger.info('budget_warning', { iter, threshold: 85, mode: 'commit-and-stop' });
          injectBudgetWarning(
            messages,
            `[ferry] BUDGET CRITICAL: ~${Math.round(budgetFraction * 100)}% of your input budget is consumed. ` +
              `You are now in commit-and-stop mode. ` +
              `Only use: bash (git operations), write_file, str_replace, commit_progress, or done. ` +
              `No exploration, no new reads — commit all work and call done immediately.`,
          );
        }

        const effectiveToolDeclarations = warned85
          ? allToolDeclarations.filter((t) => COMMIT_AND_STOP_TOOL_NAMES.has(t.name ?? ''))
          : allToolDeclarations;

        pruneMessageHistory(messages);

        const response = await ai.models.generateContent({
          model: opts.model,
          contents: messages,
          config: {
            systemInstruction: system,
            maxOutputTokens: maxTokens,
            tools:
              effectiveToolDeclarations.length > 0
                ? [{ functionDeclarations: effectiveToolDeclarations }]
                : undefined,
            toolConfig:
              effectiveToolDeclarations.length > 0
                ? {
                    functionCallingConfig: {
                      mode: FunctionCallingConfigMode.ANY,
                    },
                  }
                : undefined,
            automaticFunctionCalling: { disable: true },
          },
        });

        usage.input_tokens += response.usageMetadata?.promptTokenCount ?? 0;
        usage.output_tokens += response.usageMetadata?.candidatesTokenCount ?? 0;

        const candidate = response.candidates?.[0];
        const finishReason = candidate?.finishReason ?? 'STOP';
        const modelContent = candidate?.content;
        const parts: Part[] = modelContent?.parts ?? [];

        const functionCallParts = parts.filter((p) => p.functionCall !== undefined);

        logger.info('turn', {
          iter,
          stop_reason: finishReason,
          tools: functionCallParts.length,
          in: response.usageMetadata?.promptTokenCount ?? 0,
          out: response.usageMetadata?.candidatesTokenCount ?? 0,
        });
        emitDebug(
          {
            type: 'turn',
            iter,
            depth: 0,
            stop_reason: finishReason,
            tools: functionCallParts.length,
            mcp_tools: 0,
            in: response.usageMetadata?.promptTokenCount ?? 0,
            cache_w: 0,
            cache_r: 0,
            out: response.usageMetadata?.candidatesTokenCount ?? 0,
            elapsed_ms: Date.now() - iterStart,
          },
          logger,
        );

        if (functionCallParts.length === 0) {
          throw new FerryError('state-invariant', {
            reason: 'agent-stopped-without-done',
            stop_reason: finishReason,
          });
        }

        // Push model's response with function calls.
        messages.push({ role: 'model', parts });

        const toolResultParts: Part[] = [];

        for (const part of functionCallParts) {
          const fc = part.functionCall!;
          const name = fc.name ?? '';
          const blockInput = (fc.args ?? {}) as Record<string, unknown>;
          const callId = fc.id;

          if (name === 'done') {
            const outcome = blockInput.outcome as DoneOutcome | undefined;
            const actionable =
              outcome !== undefined ? outcome !== 'blocked' : (blockInput.actionable as boolean);
            done = { ...blockInput, actionable, outcome } as unknown as DonePayload;
            toolResultParts.push({
              functionResponse: {
                name,
                ...(callId !== undefined ? { id: callId } : {}),
                response: { output: 'ok' },
              },
            });
            continue;
          }

          if (name === 'commit_progress' && opts.commitProgress) {
            const { message } = blockInput as { message: string };
            logger.info('tool', { iter, tool: 'commit_progress', arg: message.slice(0, 120) });
            try {
              const result = await opts.commitProgress(repoRoot, branchName, message, secretScan);
              trackTool('commit_progress', result.length);
              toolResultParts.push({
                functionResponse: {
                  name,
                  ...(callId !== undefined ? { id: callId } : {}),
                  response: { output: result },
                },
              });
            } catch (e) {
              trackTool('commit_progress', 0);
              toolResultParts.push({
                functionResponse: {
                  name,
                  ...(callId !== undefined ? { id: callId } : {}),
                  response: { output: (e as Error).message, error: true },
                },
              });
            }
            continue;
          }

          if (pool.hasTool(name)) {
            const serverName = pool.getServerName(name) ?? 'unknown';
            logger.info('mcp_stdio_tool', { iter, tool: name, server: serverName });
            try {
              const result = await pool.callTool(name, blockInput);
              trackTool(name, result.length);
              toolResultParts.push({
                functionResponse: {
                  name,
                  ...(callId !== undefined ? { id: callId } : {}),
                  response: { output: result },
                },
              });
            } catch (e) {
              trackTool(name, 0);
              toolResultParts.push({
                functionResponse: {
                  name,
                  ...(callId !== undefined ? { id: callId } : {}),
                  response: { output: (e as Error).message, error: true },
                },
              });
            }
            continue;
          }

          const argHint =
            blockInput.path ?? blockInput.source ?? blockInput.command ?? blockInput.pattern ?? '';
          logger.info('tool', {
            iter,
            tool: name,
            ...(argHint ? { arg: String(argHint).slice(0, 120) } : {}),
          });

          try {
            const result = await opts.executeTool(repoRoot, name, blockInput);
            trackTool(name, result.length);
            toolResultParts.push({
              functionResponse: {
                name,
                ...(callId !== undefined ? { id: callId } : {}),
                response: { output: result },
              },
            });
          } catch (e) {
            trackTool(name, 0);
            toolResultParts.push({
              functionResponse: {
                name,
                ...(callId !== undefined ? { id: callId } : {}),
                response: { output: (e as Error).message, error: true },
              },
            });
          }
        }

        messages.push({ role: 'user', parts: toolResultParts });
        compactOldToolResults(messages, compactWindow);

        if (done) {
          emitDebug(
            {
              type: 'result',
              subtype: 'success',
              iterations: iter,
              total_in: usage.input_tokens,
              total_out: usage.output_tokens,
              elapsed_ms: Date.now() - loopStart,
            },
            logger,
          );
          return { done, usage, iterations: iter, toolCounts, toolCallRecords };
        }
      }

      throw new FerryError('state-invariant', {
        reason: 'iteration-cap-exceeded',
        cap: maxIterations,
      });
    } finally {
      await pool.close();
    }
  }

  return {
    run(input) {
      return runLoop(input);
    },
  };
}
