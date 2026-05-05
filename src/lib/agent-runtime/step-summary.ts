import { appendFileSync } from 'node:fs';
import type { AgentLoopUsage, ToolCallRecord } from '../llm/agent-loop/types.js';

export type { ToolCallRecord };

export interface AgentRunStats {
  role: string;
  iterations: number;
  usage: AgentLoopUsage;
  toolCounts: Record<string, number>;
  toolCallRecords: ToolCallRecord[];
  filesTouched: string[];
  branchPushed: string;
  outcome: string;
  stopReason?: string;
}

const TOP_N = 5;

function stopRecommendation(outcome: string, stopReason?: string): string {
  if (stopReason === 'input-token-budget-exceeded') {
    return '> ⚠️ **Token cap exceeded** — consider raising `max_tokens_per_run` or splitting the task into smaller subtasks.';
  }
  if (stopReason === 'iteration-cap-exceeded') {
    return '> ⚠️ **Iteration cap exceeded** — check for infinite loops or simplify the task.';
  }
  if (outcome === 'blocked') {
    return '> 🚨 **Blocked** — manual intervention required. Check the ticket for the blocking reason.';
  }
  if (outcome === 'approved') {
    return '> ✅ **Approved** — PR is ready to merge.';
  }
  if (outcome === 'changes_requested') {
    return '> 🔄 **Changes requested** — see PR review findings.';
  }
  if (outcome === 'implemented' || outcome === 'already_satisfied' || outcome === 'refined') {
    return '> ✅ **Completed successfully.**';
  }
  return `> ℹ️ **Outcome:** \`${outcome}\``;
}

export function formatStepSummary(stats: AgentRunStats): string {
  const {
    role,
    iterations,
    usage,
    toolCounts,
    toolCallRecords,
    filesTouched,
    branchPushed,
    outcome,
    stopReason,
  } = stats;

  const lines: string[] = [];

  lines.push(`## Ferry ${role} — run summary`);
  lines.push('');

  lines.push(stopRecommendation(outcome, stopReason));
  lines.push('');

  lines.push('### Stats');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Outcome | \`${outcome}\` |`);
  lines.push(`| Iterations | ${iterations} |`);
  const totalTokens =
    usage.input_tokens +
    usage.output_tokens +
    usage.cache_creation_input_tokens +
    usage.cache_read_input_tokens;
  if (totalTokens > 0) {
    lines.push(`| Input tokens | ${usage.input_tokens.toLocaleString()} |`);
    lines.push(`| Output tokens | ${usage.output_tokens.toLocaleString()} |`);
    lines.push(`| Cache write tokens | ${usage.cache_creation_input_tokens.toLocaleString()} |`);
    lines.push(`| Cache read tokens | ${usage.cache_read_input_tokens.toLocaleString()} |`);
  }
  lines.push('');

  const toolEntries = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]);
  if (toolEntries.length > 0) {
    lines.push('### Tools used');
    lines.push('');
    lines.push('| Tool | Calls |');
    lines.push('|------|-------|');
    for (const [tool, count] of toolEntries) {
      lines.push(`| \`${tool}\` | ${count} |`);
    }
    lines.push('');
  }

  const topBySize = [...toolCallRecords]
    .sort((a, b) => b.outputSize - a.outputSize)
    .slice(0, TOP_N);
  if (topBySize.length > 0) {
    lines.push(`### Top ${Math.min(TOP_N, topBySize.length)} tool calls by output size`);
    lines.push('');
    lines.push('| Tool | Output bytes |');
    lines.push('|------|-------------|');
    for (const rec of topBySize) {
      lines.push(`| \`${rec.name}\` | ${rec.outputSize.toLocaleString()} |`);
    }
    lines.push('');
  }

  if (filesTouched.length > 0) {
    lines.push('### Files touched');
    lines.push('');
    for (const f of filesTouched) {
      lines.push(`- \`${f}\``);
    }
    lines.push('');
  }

  if (branchPushed) {
    lines.push(`**Branch pushed:** \`${branchPushed}\``);
    lines.push('');
  }

  return lines.join('\n');
}

export function writeStepSummary(stats: AgentRunStats): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  appendFileSync(summaryPath, formatStepSummary(stats));
}
