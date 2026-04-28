/**
 * Iterator prompt + commit-message builders.
 *
 * Pure functions that assemble a prompt with full review history and format
 * the iterator commit message. The actual LLM call lives in `iterate.yml`
 * wiring; tests stay deterministic by depending only on this module.
 */

export interface IterationHistoryEntry {
  iteration: number;
  pr_sha: string;
  fingerprints: string[];
}

export interface IteratorFinding {
  rule_id: string;
  message: string;
  file?: string;
  line_start?: number;
  line_end?: number;
}

export interface IteratorPromptInput {
  ticket_key: string;
  iteration_history: IterationHistoryEntry[];
  latest_findings: IteratorFinding[];
  touch_paths: string[];
  branch_head_sha: string;
}

function renderHistoryEntry(e: IterationHistoryEntry): string {
  return [
    `- iteration=${e.iteration}`,
    `  pr_sha=${e.pr_sha}`,
    `  fingerprints=[${e.fingerprints.join(', ')}]`,
  ].join('\n');
}

function renderFinding(f: IteratorFinding): string {
  const loc =
    f.file && f.line_start
      ? `${f.file}:${f.line_start}-${f.line_end ?? f.line_start}`
      : (f.file ?? '');
  return `- ${f.rule_id} ${loc} — ${f.message}`;
}

export function buildIteratorPrompt(input: IteratorPromptInput): string {
  const lines: string[] = [];
  lines.push(`Ticket: ${input.ticket_key}`);
  lines.push(`Iteration: ${input.iteration_history.length}`);
  lines.push(`Branch HEAD: ${input.branch_head_sha}`);
  lines.push('');
  lines.push('Allowed touch_paths (scope-enforced):');
  for (const p of input.touch_paths) lines.push(`- ${p}`);
  lines.push('');
  lines.push('Latest findings:');
  for (const f of input.latest_findings) lines.push(renderFinding(f));
  lines.push('');
  lines.push('Iteration history:');
  if (input.iteration_history.length === 0) {
    lines.push('(none)');
  } else {
    for (const h of input.iteration_history) lines.push(renderHistoryEntry(h));
  }
  return lines.join('\n');
}

export interface CommitMessageInput {
  ticket_key: string;
  summary: string;
  rule_ids: string[];
  run_id: string;
}

export function formatCommitMessage(input: CommitMessageInput): string {
  return [
    `[${input.ticket_key}] fix: ${input.summary}`,
    '',
    `Fixes findings: ${input.rule_ids.join(', ')}`,
    '',
    `[ferry:iterator:${input.run_id}]`,
  ].join('\n');
}
