import { FerryError } from '../../errors/index.js';
import { resolveAnthropicAuth } from '../anthropic-auth.js';
import { createAnthropicAgentLoop } from './anthropic.js';
import { createOpenAIAgentLoop } from './openai.js';
import { createGoogleAgentLoop } from './google.js';
import type { AgentLoop } from './types.js';

export type {
  AgentLoop,
  AgentTool,
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
type SpawnSubagentHandler = (task: string) => Promise<import('./types.js').AgentLoopResult>;

export interface CreateAgentLoopOpts {
  provider: 'anthropic' | 'openai' | 'google';
  model: string;
  executeTool: ToolExecutor;
  commitProgress?: CommitProgressHandler;
  spawnSubagent?: SpawnSubagentHandler;
  maxIterations?: number;
  maxInputTokens?: number;
  maxTokens?: number;
  compactWindow?: number;
  logger?: import('../../logger/index.js').Logger;
}

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new FerryError('state-invariant', { reason: 'missing-env', key });
  }
  return val;
}

export function createAgentLoop(opts: CreateAgentLoopOpts): AgentLoop {
  if (opts.provider === 'anthropic') {
    const auth = resolveAnthropicAuth({ apiKeyEnv: 'ANTHROPIC_API_KEY' });
    return createAnthropicAgentLoop({
      ...auth,
      model: opts.model,
      executeTool: opts.executeTool,
      commitProgress: opts.commitProgress,
      spawnSubagent: opts.spawnSubagent,
      maxIterations: opts.maxIterations,
      maxInputTokens: opts.maxInputTokens,
      maxTokens: opts.maxTokens,
      compactWindow: opts.compactWindow,
      logger: opts.logger,
    });
  }

  if (opts.provider === 'openai') {
    const apiKey = requireEnv('FERRY_OPENAI_KEY');
    return createOpenAIAgentLoop({
      apiKey,
      model: opts.model,
      executeTool: opts.executeTool,
      commitProgress: opts.commitProgress,
      maxIterations: opts.maxIterations,
      maxInputTokens: opts.maxInputTokens,
      maxTokens: opts.maxTokens,
      compactWindow: opts.compactWindow,
      logger: opts.logger,
    });
  }

  if (opts.provider === 'google') {
    const apiKey = requireEnv('FERRY_GOOGLE_AI_KEY');
    return createGoogleAgentLoop({
      apiKey,
      model: opts.model,
      executeTool: opts.executeTool,
      commitProgress: opts.commitProgress,
      maxIterations: opts.maxIterations,
      maxInputTokens: opts.maxInputTokens,
      maxTokens: opts.maxTokens,
      compactWindow: opts.compactWindow,
      logger: opts.logger,
    });
  }

  throw new FerryError('state-invariant', {
    reason: 'unknown-provider',
    provider: opts.provider,
  });
}
