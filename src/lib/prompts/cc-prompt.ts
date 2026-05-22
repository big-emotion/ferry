import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Prompt resolution for the **claude-code execution path**.
 *
 * Unlike the bundled-script path (see `resolve.ts`), the claude-code path has
 * no Ferry runtime around the agent. `ferry-cc-prompt` composes the prompt as a
 * pre-step in the consumer workflow. This module is the pure core it calls.
 *
 * Override model (like `ferry.config.yaml`): Ferry ships a default; if the
 * consumer drops `prompts/<agent>.claude-code.md` in their repo it **fully
 * replaces** the default — it does not append (that is the `.extra.md` model,
 * which the claude-code path deliberately does not use).
 */

export type CcAgent = 'refiner' | 'dev' | 'review' | 'iterate';

/** The four agents that run on the claude-code path. */
export const CC_AGENTS: readonly CcAgent[] = ['refiner', 'dev', 'review', 'iterate'];

/**
 * The placeholder tokens each bundled claude-code prompt expects substituted at
 * runtime. Tokens are bare uppercase identifiers embedded in the prompt text.
 */
export const CC_PROMPT_TOKENS: Record<CcAgent, readonly string[]> = {
  refiner: ['TICKET_KEY', 'RUN_ID'],
  dev: ['TICKET_KEY', 'RUN_ID', 'REVIEW_TRANSITION_ID'],
  review: ['TICKET_KEY', 'RUN_ID', 'APPROVE_TRANSITION_ID', 'CHANGES_TRANSITION_ID'],
  iterate: ['TICKET_KEY', 'RUN_ID', 'REVIEW_TRANSITION_ID'],
};

export interface CcPromptResolution {
  /** `override` when a consumer file was used, `bundled` when Ferry's default was. */
  source: 'override' | 'bundled';
  text: string;
}

/**
 * Resolve the claude-code prompt for an agent: the consumer override at
 * `prompts/<agent>.claude-code.md` (or under `FERRY_PROMPTS_DIR`) when present,
 * otherwise the `bundledDefault` passed in by the caller.
 *
 * The bundled default is supplied as a string — not read from disk — because
 * the npm package ships only `dist/cli/`; `ferry-cc-prompt` inlines the four
 * defaults into its bundle at build time.
 */
export function resolveCcPrompt(
  agent: CcAgent,
  repoRoot: string,
  bundledDefault: string,
  _checkExists: (p: string) => boolean = existsSync,
  _readFile: (p: string, enc: BufferEncoding) => string = (p, enc) => readFileSync(p, enc),
): CcPromptResolution {
  const overridesDir = process.env.FERRY_PROMPTS_DIR || path.join(repoRoot, 'prompts');
  const overridePath = path.join(overridesDir, `${agent}.claude-code.md`);
  if (_checkExists(overridePath)) {
    return { source: 'override', text: _readFile(overridePath, 'utf8') };
  }
  return { source: 'bundled', text: bundledDefault };
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
  // Longest-first is defensive — the current token set has no shared prefixes.
  const ordered = [...tokens].sort((a, b) => b.length - a.length);
  const re = new RegExp(`\\b(${ordered.join('|')})\\b`, 'g');
  return text.replace(re, (match) => values[match] ?? match);
}
