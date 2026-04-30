import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ContentBlock,
  ToolResultBlockParam,
  Tool as AnthropicTool,
} from '@anthropic-ai/sdk/resources/messages.js';
import { FerryError } from '../../errors/index.js';
import type {
  AgentTool,
  AgentLoop,
  AgentLoopResult,
  AgentLoopUsage,
  DonePayload,
  McpServerConfig,
} from './types.js';

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

export function createAnthropicAgentLoop(opts: {
  apiKey?: string;
  model: string;
  client?: Anthropic;
  executeTool: ToolExecutor;
  commitProgress?: CommitProgressHandler;
  spawnSubagent?: SpawnSubagentHandler;
}): AgentLoop {
  const anthropic = opts.client ?? new Anthropic({ apiKey: opts.apiKey });

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
    if (input.mcpServers?.length) {
      throw new FerryError('state-invariant', { reason: 'mcp-not-implemented' });
    }
    const { system, initialPrompt, tools, repoRoot, branchName, secretScan, depth = 0 } = input;
    const maxIterations = parseInt(process.env.FERRY_DEV_MAX_ITERATIONS ?? '200', 10);
    const maxInputTokens = parseInt(process.env.FERRY_DEV_MAX_INPUT_TOKENS ?? '500000', 10);
    const maxTokens = parseInt(process.env.FERRY_DEV_MAX_TOKENS ?? '16384', 10);

    // Cached system prompt + tools — static across the run, marked once.
    const systemBlocks = [
      { type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } },
    ];
    const anthropicTools = tools.map((t, i) =>
      i === tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t,
    ) as unknown as AnthropicTool[];

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
    let done: DonePayload | null = null;
    let iter = 0;

    while (iter < maxIterations) {
      iter++;

      if (
        usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens >
        maxInputTokens
      ) {
        throw new FerryError('spend-cap', {
          reason: 'input-token-budget-exceeded',
          cap: maxInputTokens,
          consumed:
            usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
        });
      }

      const response = await anthropic.messages.create({
        model: opts.model,
        max_tokens: maxTokens,
        system: systemBlocks,
        tools: anthropicTools,
        messages,
      });

      usage.input_tokens += response.usage.input_tokens;
      usage.output_tokens += response.usage.output_tokens;
      usage.cache_creation_input_tokens += response.usage.cache_creation_input_tokens ?? 0;
      usage.cache_read_input_tokens += response.usage.cache_read_input_tokens ?? 0;
      messages.push({ role: 'assistant', content: response.content as ContentBlock[] });

      console.error(
        `[ferry:dev-loop] depth=${depth} iter=${iter} stop_reason=${response.stop_reason} tools=${response.content.filter((b) => b.type === 'tool_use').length} in=${response.usage.input_tokens} cache_w=${response.usage.cache_creation_input_tokens ?? 0} cache_r=${response.usage.cache_read_input_tokens ?? 0} out=${response.usage.output_tokens}`,
      );

      for (const block of response.content) {
        if (block.type === 'text' && block.text.trim()) {
          console.error(`[ferry:dev-think] ${block.text.trim()}`);
        }
      }

      if (response.stop_reason !== 'tool_use') {
        throw new FerryError('state-invariant', {
          reason: 'agent-stopped-without-done',
          stop_reason: response.stop_reason,
        });
      }

      const toolResults: ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        if (block.name === 'done') {
          done = block.input as DonePayload;
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'ok' });
          continue;
        }

        if (block.name === 'commit_progress' && opts.commitProgress) {
          const { message } = block.input as { message: string };
          console.error(
            `[ferry:dev-tool] depth=${depth} iter=${iter} tool=commit_progress arg=${message.slice(0, 120)}`,
          );
          try {
            const result = await opts.commitProgress(repoRoot, branchName, message, secretScan);
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
          } catch (e) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: (e as Error).message,
              is_error: true,
            });
          }
          continue;
        }

        if (block.name === 'spawn_subagent' && opts.spawnSubagent) {
          const { task } = block.input as { task: string };
          console.error(
            `[ferry:dev-tool] depth=${depth} iter=${iter} tool=spawn_subagent arg=${task.slice(0, 120)}`,
          );
          try {
            const subResult = await opts.spawnSubagent(task);
            usage.input_tokens += subResult.usage.input_tokens;
            usage.output_tokens += subResult.usage.output_tokens;
            usage.cache_creation_input_tokens += subResult.usage.cache_creation_input_tokens;
            usage.cache_read_input_tokens += subResult.usage.cache_read_input_tokens;
            if (!subResult.done.actionable) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: `Sub-agent could not complete task: ${subResult.done.reason_if_not_actionable ?? 'no reason given'}`,
                is_error: true,
              });
            } else {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: subResult.done.summary,
              });
            }
          } catch (e) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: (e as Error).message,
              is_error: true,
            });
          }
          continue;
        }

        const blockInput = block.input as Record<string, unknown>;
        const argHint =
          blockInput.path ?? blockInput.source ?? blockInput.command ?? blockInput.pattern ?? '';
        console.error(
          `[ferry:dev-tool] depth=${depth} iter=${iter} tool=${block.name}${argHint ? ` arg=${String(argHint).slice(0, 120)}` : ''}`,
        );

        try {
          const result = await opts.executeTool(repoRoot, block.name, blockInput);
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
        } catch (e) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: (e as Error).message,
            is_error: true,
          });
        }
      }

      // Move the cache breakpoint to the new tool results: strip it from the
      // previous tool-result turn first (keeps us within Anthropic's 4-block limit).
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === 'user' && Array.isArray(msg.content)) {
          const content = msg.content as ToolResultBlockParam[];
          if (content.some((b) => b.type === 'tool_result')) {
            const lastIdx = content.length - 1;
            if ('cache_control' in content[lastIdx]) {
              const entry = { ...content[lastIdx] } as ToolResultBlockParam & {
                cache_control?: unknown;
              };
              delete entry.cache_control;
              content[lastIdx] = entry as ToolResultBlockParam;
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

      if (done) return { done, usage, iterations: iter };
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
