import { randomBytes } from 'node:crypto';
import {
  resolveCcPrompt,
  substituteTokens,
  CC_AGENTS,
  CC_PROMPT_TOKENS,
  type CcAgent,
  type CcPromptResolution,
} from '../../lib/prompts/cc-prompt.js';

/** A usage / configuration error — reported to stderr with exit 1, no stack trace. */
export class UsageError extends Error {}

export interface CcPromptArgs {
  agent: CcAgent;
  repoRoot: string;
  /** GITHUB_OUTPUT key the resolved prompt is written under. */
  outputName: string;
  /** Token → runtime value, covering exactly `CC_PROMPT_TOKENS[agent]`. */
  values: Record<string, string>;
}

/** The CLI flag that supplies each placeholder token. */
const FLAG_FOR_TOKEN: Record<string, string> = {
  TICKET_KEY: '--ticket-key',
  RUN_ID: '--run-id',
  REVIEW_TRANSITION_ID: '--review-transition-id',
  APPROVE_TRANSITION_ID: '--approve-transition-id',
  CHANGES_TRANSITION_ID: '--changes-transition-id',
};

/** Tokens that must be supplied and non-empty — always present in a dispatch payload. */
const REQUIRED_TOKENS = new Set(['TICKET_KEY', 'RUN_ID']);

function getArg(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
}

export function parseArgs(argv: string[]): CcPromptArgs {
  const agent = getArg(argv, '--agent');
  if (!agent) {
    throw new UsageError('--agent is required');
  }
  if (!CC_AGENTS.includes(agent as CcAgent)) {
    throw new UsageError(`--agent must be one of: ${CC_AGENTS.join(', ')}`);
  }

  const values: Record<string, string> = {};
  for (const token of CC_PROMPT_TOKENS[agent as CcAgent]) {
    const flag = FLAG_FOR_TOKEN[token];
    const raw = getArg(argv, flag);
    if (REQUIRED_TOKENS.has(token)) {
      if (!raw) {
        throw new UsageError(`${flag} is required and must be non-empty`);
      }
      values[token] = raw;
    } else {
      // Transition ids may be empty — e.g. a consumer who disables the
      // reviewer approve transition passes an empty APPROVE_TRANSITION_ID.
      values[token] = raw ?? '';
    }
  }

  return {
    agent: agent as CcAgent,
    repoRoot: getArg(argv, '--repo-root') || process.env.GITHUB_WORKSPACE || process.cwd(),
    outputName: getArg(argv, '--output-name') || 'prompt',
    values,
  };
}

/**
 * Resolve the agent's prompt (consumer override or bundled default) and
 * substitute its runtime tokens. Throws `UsageError` on an empty prompt.
 */
export function renderPrompt(
  args: CcPromptArgs,
  bundled: Record<CcAgent, string>,
  _checkExists?: (p: string) => boolean,
  _readFile?: (p: string, enc: BufferEncoding) => string,
): CcPromptResolution {
  const resolved = resolveCcPrompt(
    args.agent,
    args.repoRoot,
    bundled[args.agent],
    _checkExists,
    _readFile,
  );
  if (resolved.text.trim() === '') {
    throw new UsageError(
      resolved.source === 'override'
        ? `consumer override prompts/${args.agent}.claude-code.md is empty`
        : `bundled prompt for "${args.agent}" is empty`,
    );
  }
  return { source: resolved.source, text: substituteTokens(resolved.text, args.values) };
}

/**
 * Build a GitHub Actions multiline step-output block (`name<<DELIM … DELIM`).
 * The delimiter is random and regenerated until no content line collides with it.
 */
export function formatGithubOutput(
  name: string,
  value: string,
  _genDelim: () => string = () => `ferry_eof_${randomBytes(8).toString('hex')}`,
): string {
  const body = value.replace(/\n+$/, '');
  const lines = body.split('\n');
  let delim = _genDelim();
  while (lines.includes(delim)) {
    delim = _genDelim();
  }
  return `${name}<<${delim}\n${body}\n${delim}\n`;
}
