import { existsSync, readFileSync } from 'node:fs';
import { resolvePromptPath, loadProjectSnippet, loadAgentExtension } from '../prompts/resolve.js';

export function buildSystem(
  promptName: string,
  repoRoot: string,
  opts?: {
    extraParts?: (string | null | undefined)[];
    separator?: string;
    _checkExists?: (p: string) => boolean;
    _readFile?: (p: string, enc: BufferEncoding) => string;
  },
): string {
  const _checkExists = opts?._checkExists ?? existsSync;
  const _readFile = opts?._readFile ?? ((p, enc) => readFileSync(p, enc));
  const resolvedPath = resolvePromptPath(promptName, repoRoot, _checkExists);
  const systemBase = _readFile(resolvedPath, 'utf8');
  const agentExtension = loadAgentExtension(promptName, repoRoot, _checkExists, _readFile);
  const projectSnippet = loadProjectSnippet(repoRoot, _checkExists, _readFile);
  const separator = opts?.separator ?? '\n\n';
  const parts = [
    systemBase,
    agentExtension ? `## Project-specific guidance for ${promptName}\n\n${agentExtension}` : null,
    ...(opts?.extraParts ?? []),
    projectSnippet ? `## Project conventions\n\n${projectSnippet}` : null,
  ].filter((p): p is string => Boolean(p));
  return parts.join(separator);
}

export function loadOptionalPrompt(
  name: string,
  repoRoot: string,
  _readFile: (p: string, enc: BufferEncoding) => string = (p, enc) => readFileSync(p, enc),
  _checkExists: (p: string) => boolean = existsSync,
): string | null {
  const resolved = resolvePromptPath(name, repoRoot, _checkExists);
  try {
    return _readFile(resolved, 'utf8');
  } catch {
    return null;
  }
}

export function buildTicketBlock(
  ticketKey: string,
  issue: { summary: string; issueType: string; description: string },
  opts?: { labels?: string; comments?: string; typeOverride?: string },
): string {
  const effectiveType = opts?.typeOverride ?? issue.issueType;
  return [
    `TICKET: ${ticketKey}`,
    `TITLE: ${issue.summary}`,
    `TYPE: ${effectiveType}`,
    opts?.labels !== undefined ? `LABELS: ${opts.labels || 'none'}` : null,
    `DESCRIPTION:\n${issue.description}`,
    opts?.comments ? `COMMENTS:\n${opts.comments}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
