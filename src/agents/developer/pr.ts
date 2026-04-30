import type { ValidationEntry } from '../../lib/llm/agent-loop/types.js';

export { ValidationEntry };

export interface PrTitleInput {
  ticketKey: string;
  summary: string;
}

export function formatPullRequestTitle(input: PrTitleInput): string {
  return `${input.ticketKey} ${input.summary}`;
}

export interface PrBodyInput {
  ticketKey: string;
  jiraBaseUrl: string;
  runId: string;
  summary: string;
  subtasks: string[];
  validation: ValidationEntry[];
  notes: string[];
}

export function formatPullRequestBody(input: PrBodyInput): string {
  const ticketUrl = `${input.jiraBaseUrl.replace(/\/+$/, '')}/browse/${input.ticketKey}`;

  const subtaskLines = input.subtasks.length > 0 ? input.subtasks.join('\n') : '_None_';

  const validationLines =
    input.validation.length > 0
      ? input.validation.map((v) => `- \`${v.command}\` — ${v.outcome}`).join('\n')
      : '_None_';

  const notesLines =
    input.notes.length > 0 ? input.notes.map((n) => `- ${n}`).join('\n') : '_None_';

  return [
    `## Summary`,
    input.summary,
    ``,
    `## Included subtasks`,
    subtaskLines,
    ``,
    `## Validation`,
    validationLines,
    ``,
    `## Notes`,
    notesLines,
    ``,
    `---`,
    `[${input.ticketKey}](${ticketUrl}) · \`[ferry:dev:${input.runId}]\``,
    ``,
  ].join('\n');
}

