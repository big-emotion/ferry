import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ContentBlock,
  ToolResultBlockParam,
  Tool as AnthropicTool,
} from '@anthropic-ai/sdk/resources/messages.js';
import { FerryError } from '../../errors/index.js';
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
  HttpMcpServerConfig,
  StdioMcpServerConfig,
  ToolCallRecord,
} from './types.js';
import { isStdioMcpServer, isHttpMcpServer } from './types.js';
import { compactOldToolResults } from './compact.js';
import { computeCostEur } from '../pricing.js';
import type { ThinkingParam } from '../thinking.js';

// Tools kept available in commit-and-stop mode (>=85% budget used).
const COMMIT_AND_STOP_TOOL_NAMES = new Set([
  'bash',
  'write_file',
  'str_replace',
  'commit_progress',
  'done',
]);

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
type SpawnSubagentHandler = (task: string) => Promise<AgentLoopResult>;

interface McpServerParam {
  type: 'url';
  name: string;
  url: string;
  authorization_token?: string;
}

interface McpToolsetParam {
  type: 'mcp_toolset';
  mcp_server_name: string;
  allowed_tools?: string[];
  denied_tools?: string[];
}

type ContentLike = { type: string; [key: string]: unknown };

const KEEP_LAST_TURNS = 6;
const STUB = '[truncated: tool result elided to save context]';

function pruneMessageHistory(messages: MessageParam[]): void {
  // messages[0] carries the cached seed — never touch it.
  const cutoff = messages.length - KEEP_LAST_TURNS * 2;
  if (cutoff <= 1) return;
  for (let i = 1; i < cutoff; i++) {
    const msg = messages[i];
    if (msg.role !== 'user' || !Array.isArray(msg.content)) continue;
    const content = msg.content as ToolResultBlockParam[];
    if (!content.some((b) => b.type === 'tool_result' && b.content !== STUB)) continue;
    msg.content = content.map((b) =>
      b.type === 'tool_result' && b.content !== STUB ? { ...b, content: STUB } : b,
    );
  }
}

function injectBudgetWarning(messages: MessageParam[], text: string): void {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return;
  if (typeof last.content === 'string') {
    last.content = [
      { type: 'text', text: last.content },
      { type: 'text', text },
    ];
  } else if (Array.isArray(last.content)) {
    last.content = [...last.content, { type: 'text', text }];
  }
}

interface ApiResponse {
  stop_reason: string;
  content: ContentLike[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

interface BetaMessagesClient {
  create(params: Record<string, unknown>): Promise<ApiResponse>;
}

function buildMcpParams(mcpServers: HttpMcpServerConfig[]): {
  mcpServerParams: McpServerParam[];
  mcpToolsets: McpToolsetParam[];
} {
  const mcpServerParams: McpServerParam[] = mcpServers.map((s) => ({
    type: 'url',
    name: s.name,
    url: s.url,
    ...(s.authorization_token ? { authorization_token: s.authorization_token } : {}),
  }));
  const mcpToolsets: McpToolsetParam[] = mcpServers.map((s) => ({
    type: 'mcp_toolset',
    mcp_server_name: s.name,
    ...(s.allowed_tools?.length ? { allowed_tools: s.allowed_tools } : {}),
    ...(s.denied_tools?.length ? { denied_tools: s.denied_tools } : {}),
  }));
  return { mcpServerParams, mcpToolsets };
}

export function createAnthropicAgentLoop(opts: {
  apiKey?: string;
  authToken?: string;
  model: string;
  client?: Anthropic;
  executeTool: ToolExecutor;
  commitProgress?: CommitProgressHandler;
  spawnSubagent?: SpawnSubagentHandler;
  maxIterations?: number;
  maxInputTokens?: number;
  maxTokens?: number;
  maxCostEur?: number;
  compactWindow?: number;
  /** Optional extended-thinking config; passed through to messages.create when set. */
  thinking?: ThinkingParam;
  logger?: Logger;
}): AgentLoop {
  const anthropic =
    opts.client ?? new Anthropic({ apiKey: opts.apiKey, authToken: opts.authToken });
  const logger = opts.logger ?? createLogger('', 'ferry:dev-loop');

  async function runLoop(input: {
    system: string;
    initialPrompt: string;
    tools: AgentTool[];
    repoRoot: string;
    branchName: string;
    secretScan: () => Promise<void>;
    mcpServers?: McpServerConfig[];
    depth?: number;
  }): Promise<AgentLoopResult> {
    const { system, initialPrompt, tools, repoRoot, branchName, secretScan, depth = 0 } = input;
    const maxIterations =
      opts.maxIterations ?? parseInt(process.env.FERRY_DEV_MAX_ITERATIONS ?? '200', 10);
    const maxInputTokens =
      opts.maxInputTokens ?? parseInt(process.env.FERRY_DEV_MAX_INPUT_TOKENS ?? '500000', 10);
    const maxTokens = opts.maxTokens ?? parseInt(process.env.FERRY_DEV_MAX_TOKENS ?? '16384', 10);
    const maxCostEur = opts.maxCostEur;
    const compactWindow =
      opts.compactWindow ?? parseInt(process.env.FERRY_DEV_COMPACT_WINDOW ?? '8', 10);

    // Separate HTTP (server-side) and stdio (client-side) MCP servers.
    const allServers = input.mcpServers ?? [];
    const httpServers = allServers.filter(
      (s): s is HttpMcpServerConfig => isHttpMcpServer(s) && 'url' in s,
    );
    const stdioServers = allServers.filter((s): s is StdioMcpServerConfig => isStdioMcpServer(s));

    const hasHttp = httpServers.length > 0;
    const { mcpServerParams, mcpToolsets } = hasHttp
      ? buildMcpParams(httpServers)
      : { mcpServerParams: [], mcpToolsets: [] };

    // Connect stdio MCP servers and collect their tools.
    const pool = new McpClientPool();
    try {
      if (stdioServers.length > 0) {
        await pool.connect(stdioServers);
        if (pool.getTools().length > 0) {
          logger.info('stdio_mcp_tools', {
            depth,
            count: pool.getTools().length,
            servers: stdioServers.map((s) => s.name).join(','),
          });
        }
      }

      return await runLoopCore({
        system,
        initialPrompt,
        tools,
        repoRoot,
        branchName,
        secretScan,
        depth,
        maxIterations,
        maxInputTokens,
        maxTokens,
        maxCostEur,
        compactWindow,
        hasHttp,
        mcpServerParams,
        mcpToolsets,
        pool,
      });
    } finally {
      await pool.close();
    }
  }

  async function runLoopCore(params: {
    system: string;
    initialPrompt: string;
    tools: AgentTool[];
    repoRoot: string;
    branchName: string;
    secretScan: () => Promise<void>;
    depth: number;
    maxIterations: number;
    maxInputTokens: number;
    maxTokens: number;
    maxCostEur: number | undefined;
    compactWindow: number;
    hasHttp: boolean;
    mcpServerParams: McpServerParam[];
    mcpToolsets: McpToolsetParam[];
    pool: McpClientPool;
  }): Promise<AgentLoopResult> {
    const {
      system,
      initialPrompt,
      tools,
      repoRoot,
      branchName,
      secretScan,
      depth,
      maxIterations,
      maxInputTokens,
      maxTokens,
      maxCostEur,
      compactWindow,
      hasHttp,
      mcpServerParams,
      mcpToolsets,
      pool,
    } = params;

    // Merge native tools with stdio MCP tools; put cache breakpoint on the last entry.
    const nativeAndStdioTools = [...tools, ...pool.getTools()];
    const anthropicTools = nativeAndStdioTools.map((t, i) =>
      i === nativeAndStdioTools.length - 1
        ? { ...t, cache_control: { type: 'ephemeral' as const } }
        : t,
    ) as unknown as AnthropicTool[];

    // Cached system prompt — static across the run.
    const systemBlocks = [
      { type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } },
    ];

    const allTools = [...anthropicTools, ...(mcpToolsets as unknown as AnthropicTool[])];

    const messages: MessageParam[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: initialPrompt, cache_control: { type: 'ephemeral' } }],
      },
    ];
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

      // Anthropic bills cache reads at ~10% of fresh input tokens; weight them
      // accordingly so the cap approximates dollar spend rather than raw volume.
      const billableEquiv =
        usage.input_tokens +
        usage.cache_read_input_tokens * 0.1 +
        usage.cache_creation_input_tokens;
      if (billableEquiv > maxInputTokens) {
        throw new FerryError('spend-cap', {
          reason: 'input-token-budget-exceeded',
          cap: maxInputTokens,
          consumed: billableEquiv,
        });
      }

      if (maxCostEur !== undefined) {
        const costEur = computeCostEur(
          'anthropic',
          opts.model,
          usage.input_tokens + usage.cache_creation_input_tokens,
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
        logger.info('budget_warning', { depth, iter, threshold: 70, remaining_pct: remaining });
        injectBudgetWarning(
          messages,
          `[ferry] You have used ~${Math.round(budgetFraction * 100)}% of your input budget (${remaining}% remaining). ` +
            `Wrap up now: stop exploration, finish the current change, commit, and push.`,
        );
      }

      if (!warned85 && budgetFraction >= 0.85) {
        warned85 = true;
        logger.info('budget_warning', { depth, iter, threshold: 85, mode: 'commit-and-stop' });
        injectBudgetWarning(
          messages,
          `[ferry] BUDGET CRITICAL: ~${Math.round(budgetFraction * 100)}% of your input budget is consumed. ` +
            `You are now in commit-and-stop mode. ` +
            `Only use: bash (git operations), write_file, str_replace, commit_progress, or done. ` +
            `No exploration, no new reads — commit all work and call done immediately.`,
        );
      }

      const effectiveTools = warned85
        ? allTools.filter((t) =>
            COMMIT_AND_STOP_TOOL_NAMES.has((t as unknown as { name?: string }).name ?? ''),
          )
        : allTools;

      pruneMessageHistory(messages);

      const baseParams = {
        model: opts.model,
        max_tokens: maxTokens,
        system: systemBlocks,
        tools: effectiveTools,
        messages,
        ...(opts.thinking !== undefined ? { thinking: opts.thinking } : {}),
      };

      const response: ApiResponse = hasHttp
        ? await (
            anthropic as unknown as { beta: { messages: BetaMessagesClient } }
          ).beta.messages.create({
            ...baseParams,
            mcp_servers: mcpServerParams,
            betas: ['mcp-client-2025-11-20'],
          })
        : ((await anthropic.messages.create(baseParams)) as unknown as ApiResponse);

      usage.input_tokens += response.usage.input_tokens;
      usage.output_tokens += response.usage.output_tokens;
      usage.cache_creation_input_tokens += response.usage.cache_creation_input_tokens ?? 0;
      usage.cache_read_input_tokens += response.usage.cache_read_input_tokens ?? 0;

      const contentBlocks = response.content;
      messages.push({ role: 'assistant', content: contentBlocks as unknown as ContentBlock[] });

      const mcpToolUseCount = contentBlocks.filter((b) => b.type === 'mcp_tool_use').length;
      const toolUseCount = contentBlocks.filter((b) => b.type === 'tool_use').length;
      const cacheW = response.usage.cache_creation_input_tokens ?? 0;
      const cacheR = response.usage.cache_read_input_tokens ?? 0;
      logger.info('turn', {
        depth,
        iter,
        stop_reason: response.stop_reason,
        tools: toolUseCount,
        mcp_tools: mcpToolUseCount,
        in: response.usage.input_tokens,
        cache_w: cacheW,
        cache_r: cacheR,
        out: response.usage.output_tokens,
      });
      emitDebug(
        {
          type: 'turn',
          iter,
          depth,
          stop_reason: response.stop_reason,
          tools: toolUseCount,
          mcp_tools: mcpToolUseCount,
          in: response.usage.input_tokens,
          cache_w: cacheW,
          cache_r: cacheR,
          out: response.usage.output_tokens,
          elapsed_ms: Date.now() - iterStart,
        },
        logger,
      );

      for (const block of contentBlocks) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          logger.debug('think', { depth, iter, text: block.text.trim() });
        }
        if (block.type === 'mcp_tool_use') {
          // Executed server-side by the Anthropic MCP connector — log and count only (no output size).
          const mcpName = String(block.name ?? 'unknown');
          logger.info('mcp_tool', {
            depth,
            iter,
            tool: mcpName,
            server: String(block.server_name ?? 'unknown'),
          });
          toolCounts[mcpName] = (toolCounts[mcpName] ?? 0) + 1;
        }
      }

      if (response.stop_reason !== 'tool_use') {
        throw new FerryError('state-invariant', {
          reason: 'agent-stopped-without-done',
          stop_reason: response.stop_reason,
        });
      }

      const toolResults: ToolResultBlockParam[] = [];

      for (const block of contentBlocks) {
        if (block.type !== 'tool_use') continue;

        const id = block.id as string;
        const name = block.name as string;
        const blockInput = block.input as Record<string, unknown>;

        if (name === 'done') {
          const outcome = blockInput.outcome as DoneOutcome | undefined;
          const actionable =
            outcome !== undefined ? outcome !== 'blocked' : (blockInput.actionable as boolean);
          done = { ...blockInput, actionable, outcome } as unknown as DonePayload;
          toolResults.push({ type: 'tool_result', tool_use_id: id, content: 'ok' });
          continue;
        }

        if (name === 'commit_progress' && opts.commitProgress) {
          const { message } = blockInput as { message: string };
          logger.info('tool', { depth, iter, tool: 'commit_progress', arg: message.slice(0, 120) });
          try {
            const result = await opts.commitProgress(repoRoot, branchName, message, secretScan);
            trackTool('commit_progress', result.length);
            toolResults.push({ type: 'tool_result', tool_use_id: id, content: result });
          } catch (e) {
            trackTool('commit_progress', 0);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: id,
              content: (e as Error).message,
              is_error: true,
            });
          }
          continue;
        }

        if (name === 'spawn_subagent' && opts.spawnSubagent) {
          const { task } = blockInput as { task: string };
          logger.info('tool', { depth, iter, tool: 'spawn_subagent', arg: task.slice(0, 120) });
          try {
            const subResult = await opts.spawnSubagent(task);
            usage.input_tokens += subResult.usage.input_tokens;
            usage.output_tokens += subResult.usage.output_tokens;
            usage.cache_creation_input_tokens += subResult.usage.cache_creation_input_tokens;
            usage.cache_read_input_tokens += subResult.usage.cache_read_input_tokens;
            // Merge sub-agent tool data into parent's tracking.
            for (const [tName, tCount] of Object.entries(subResult.toolCounts)) {
              toolCounts[tName] = (toolCounts[tName] ?? 0) + tCount;
            }
            toolCallRecords.push(...subResult.toolCallRecords);
            if (!subResult.done.actionable) {
              trackTool('spawn_subagent', 0);
              toolResults.push({
                type: 'tool_result',
                tool_use_id: id,
                content: `Sub-agent could not complete task: ${subResult.done.reason ?? subResult.done.reason_if_not_actionable ?? 'no reason given'}`,
                is_error: true,
              });
            } else {
              trackTool('spawn_subagent', subResult.done.summary.length);
              toolResults.push({
                type: 'tool_result',
                tool_use_id: id,
                content: subResult.done.summary,
              });
            }
          } catch (e) {
            trackTool('spawn_subagent', 0);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: id,
              content: (e as Error).message,
              is_error: true,
            });
          }
          continue;
        }

        // Dispatch to stdio MCP pool if the tool is provided by a connected server.
        if (pool.hasTool(name)) {
          const serverName = pool.getServerName(name) ?? 'unknown';
          logger.info('mcp_stdio_tool', { depth, iter, tool: name, server: serverName });
          try {
            const result = await pool.callTool(name, blockInput);
            trackTool(name, result.length);
            toolResults.push({ type: 'tool_result', tool_use_id: id, content: result });
          } catch (e) {
            trackTool(name, 0);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: id,
              content: (e as Error).message,
              is_error: true,
            });
          }
          continue;
        }

        const argHint =
          blockInput.path ?? blockInput.source ?? blockInput.command ?? blockInput.pattern ?? '';
        logger.info('tool', {
          depth,
          iter,
          tool: name,
          ...(argHint ? { arg: String(argHint).slice(0, 120) } : {}),
        });

        try {
          const result = await opts.executeTool(repoRoot, name, blockInput);
          trackTool(name, result.length);
          toolResults.push({ type: 'tool_result', tool_use_id: id, content: result });
        } catch (e) {
          trackTool(name, 0);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: id,
            content: (e as Error).message,
            is_error: true,
          });
        }
      }

      // Move the cache breakpoint to the new tool results: strip it from the
      // previous tool-result turn first (keeps us within Anthropic's 4-block limit).
      // Scan every block — injectBudgetWarning may have appended a text block
      // after the cache-controlled tool_result, so it isn't always last.
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === 'user' && Array.isArray(msg.content)) {
          const content = msg.content as ToolResultBlockParam[];
          if (content.some((b) => b.type === 'tool_result')) {
            for (let j = 0; j < content.length; j++) {
              if ('cache_control' in content[j]) {
                const entry = { ...content[j] } as ToolResultBlockParam & {
                  cache_control?: unknown;
                };
                delete entry.cache_control;
                content[j] = entry as ToolResultBlockParam;
              }
            }
            break;
          }
        }
      }
      if (toolResults.length > 0) {
        const last = toolResults[toolResults.length - 1];
        toolResults[toolResults.length - 1] = { ...last, cache_control: { type: 'ephemeral' } };
      }

      messages.push({ role: 'user', content: toolResults });
      compactOldToolResults(messages, compactWindow);

      if (done) {
        emitDebug(
          {
            type: 'result',
            subtype: 'success',
            iterations: iter,
            total_in:
              usage.input_tokens +
              usage.cache_read_input_tokens +
              usage.cache_creation_input_tokens,
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
  }

  return {
    run(input) {
      return runLoop({ ...input, depth: 0 });
    },
  };
}
