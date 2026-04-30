import { execSync } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';
import { createAnthropicAgentLoop } from '../../lib/llm/agent-loop/anthropic.js';
import type { AgentLoopResult } from '../../lib/llm/agent-loop/types.js';
import { TOOL_SCHEMAS, COMMIT_PROGRESS_SCHEMA, executeTool } from './tools.js';

export async function runAgentLoop(opts: {
  anthropic: Anthropic;
  model: string;
  system: string;
  initialPrompt: string;
  repoRoot: string;
  branchName: string;
  secretScan: () => Promise<void>;
}): Promise<AgentLoopResult> {
  const { anthropic, model, system, initialPrompt, repoRoot, branchName, secretScan } = opts;
  const tools = [...TOOL_SCHEMAS, COMMIT_PROGRESS_SCHEMA];

  const loop = createAnthropicAgentLoop({
    client: anthropic,
    model,
    executeTool,
    commitProgress: async (root, branch, message, scan) => {
      execSync('git add -A', { cwd: root });
      const status = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' });
      if (!status.trim()) return 'nothing to commit';
      await scan();
      execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: root });
      execSync(`git push origin ${branch} --force-with-lease`, { cwd: root });
      return 'committed and pushed';
    },
  });

  return loop.run({ system, initialPrompt, tools, repoRoot, branchName, secretScan });
}
