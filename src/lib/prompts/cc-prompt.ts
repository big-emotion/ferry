import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

/** Prompt resolution for Ferry's direct-action execution paths. */

export type DirectActionPromptPath = 'claude-code' | 'codex-cli';
export type CcAgent = 'refiner' | 'dev' | 'review' | 'iterate' | 'merge';

/** The agents that run on direct-action paths. */
export const CC_AGENTS: readonly CcAgent[] = ['refiner', 'dev', 'review', 'iterate', 'merge'];
export const DIRECT_ACTION_PROMPT_PATHS: readonly DirectActionPromptPath[] = [
  'claude-code',
  'codex-cli',
];

/**
 * The placeholder tokens each bundled direct-action prompt expects substituted
 * at runtime. Tokens are bare uppercase identifiers embedded in the prompt text.
 */
export const CC_PROMPT_TOKENS: Record<CcAgent, readonly string[]> = {
  refiner: ['TICKET_KEY', 'RUN_ID'],
  dev: ['TICKET_KEY', 'RUN_ID', 'REVIEW_TRANSITION_ID'],
  review: ['TICKET_KEY', 'RUN_ID', 'APPROVE_TRANSITION_ID', 'CHANGES_TRANSITION_ID'],
  iterate: ['TICKET_KEY', 'RUN_ID', 'REVIEW_TRANSITION_ID'],
  merge: ['TICKET_KEY', 'RUN_ID'],
};

export interface CcPromptResolution {
  /** `override` when a consumer file replaced the default, `local-overlay` when a `.local.md` was appended on top, `bundled` when Ferry's default was used as-is. */
  source: 'override' | 'local-overlay' | 'bundled';
  text: string;
}

/**
 * Resolve a direct-action prompt for an agent. The base is the consumer full
 * override at `prompts/<agent>.<path>.md` (or under `FERRY_PROMPTS_DIR`) when
 * present, else the `bundledDefault`. A `prompts/<agent>.<path>.local.md` file
 * is ALWAYS appended on top of that base — even when a full override exists.
 *
 * Appending unconditionally (rather than only when no override is present)
 * removes a footgun: a repo that ships its bundled prompt source at
 * `prompts/<agent>.<path>.md` (e.g. Ferry dogfooding itself) would otherwise
 * silently shadow its own `.local.md` overlay.
 */
export function resolveActionPrompt(
  actionPath: DirectActionPromptPath,
  agent: CcAgent,
  repoRoot: string,
  bundledDefault: string,
  _checkExists: (p: string) => boolean = existsSync,
  _readFile: (p: string, enc: BufferEncoding) => string = (p, enc) => readFileSync(p, enc),
): CcPromptResolution {
  const overridesDir = process.env.FERRY_PROMPTS_DIR || path.join(repoRoot, 'prompts');
  const overridePath = path.join(overridesDir, `${agent}.${actionPath}.md`);
  const hasOverride = _checkExists(overridePath);
  const base = hasOverride ? _readFile(overridePath, 'utf8') : bundledDefault;

  const localOverlayPath = path.join(overridesDir, `${agent}.${actionPath}.local.md`);
  if (_checkExists(localOverlayPath)) {
    const local = _readFile(localOverlayPath, 'utf8');
    return {
      source: 'local-overlay',
      text: `${base}\n\n## Project-specific guidance for ${agent} (${actionPath})\n\n${local}`,
    };
  }
  return { source: hasOverride ? 'override' : 'bundled', text: base };
}

/** Backwards-compatible helper for the original claude-code prompt CLI/tests. */
export function resolveCcPrompt(
  agent: CcAgent,
  repoRoot: string,
  bundledDefault: string,
  _checkExists: (p: string) => boolean = existsSync,
  _readFile: (p: string, enc: BufferEncoding) => string = (p, enc) => readFileSync(p, enc),
): CcPromptResolution {
  return resolveActionPrompt(
    'claude-code',
    agent,
    repoRoot,
    bundledDefault,
    _checkExists,
    _readFile,
  );
}

/**
 * Replace placeholder tokens in a prompt with their runtime values.
 *
 * Single-pass, `\b`-anchored alternation: a value substituted into the output
 * is never re-scanned, so a value that happens to equal another token name
 * stays literal. Word boundaries keep a token from matching inside a longer
 * identifier. An empty-string value is valid (e.g. a disabled transition id).
 */
export function substituteTokens(text: string, values: Record<string, string>): string {
  const tokens = Object.keys(values);
  if (tokens.length === 0) {
    return text;
  }
  const ordered = [...tokens].sort((a, b) => b.length - a.length);
  const re = new RegExp(`\\b(${ordered.join('|')})\\b`, 'g');
  return text.replace(re, (match) => values[match] ?? match);
}
