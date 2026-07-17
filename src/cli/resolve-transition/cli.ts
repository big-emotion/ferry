import type { FerryConfig } from '../../lib/config.js';
import { resolveConfiguredTransitionId } from '../../lib/io/tracker/transition-match.js';
import type { TrackerTransition } from '../../lib/io/tracker/types.js';

/** A usage / configuration error — reported to stderr with exit 1, no stack trace. */
export class UsageError extends Error {}

export const RESOLVE_AGENTS = ['dev', 'iterate', 'review', 'merge'] as const;
export type ResolveAgent = (typeof RESOLVE_AGENTS)[number];

export const RESOLVE_KINDS = ['review', 'approve', 'changes', 'done'] as const;
export type ResolveKind = (typeof RESOLVE_KINDS)[number];

export interface ResolveTransitionArgs {
  repoRoot: string;
  ticketKey: string;
  agent: ResolveAgent;
  kind: ResolveKind;
  /** Explicit override id (`FERRY_*_TRANSITION_ID`); '' when none. */
  fallbackId: string;
  /** GITHUB_OUTPUT key the resolved id is written under. */
  outputName: string;
}

/**
 * The config `auto_transition*` status name for an (agent, kind) pair, or null
 * when that transition is disabled. Throws on an unsupported pair — only the
 * reviewer approves/requests-changes, the developer and iterator advance to the
 * review column, and only the merger moves to done (FR32).
 */
export function targetStatusFor(
  cfg: FerryConfig,
  agent: ResolveAgent,
  kind: ResolveKind,
): string | null {
  const agents = cfg.workflow.agents;
  if (kind === 'review') {
    if (agent === 'dev') return agents.developer.auto_transition;
    if (agent === 'iterate') return agents.iterator.auto_transition;
  }
  if (agent === 'review') {
    if (kind === 'approve') return agents.reviewer.auto_transition_approve;
    if (kind === 'changes') return agents.reviewer.auto_transition_changes;
  }
  if (agent === 'merge' && kind === 'done') {
    return agents.merger.auto_transition_done;
  }
  throw new UsageError(`unsupported agent/kind: ${agent}/${kind}`);
}

/**
 * Resolve the transition id for this (agent, kind), preferring an explicit
 * override and otherwise auto-resolving the config status name via the tracker.
 */
export async function resolveTransition(
  args: ResolveTransitionArgs,
  cfg: FerryConfig,
  fetchTransitions: (key: string) => Promise<TrackerTransition[]>,
): Promise<string> {
  return resolveConfiguredTransitionId({
    ticketKey: args.ticketKey,
    targetStatusName: targetStatusFor(cfg, args.agent, args.kind),
    explicitId: args.fallbackId,
    fetchTransitions,
  });
}

function getArg(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
}

export function parseArgs(argv: string[]): ResolveTransitionArgs {
  const ticketKey = getArg(argv, '--ticket-key');
  if (!ticketKey) throw new UsageError('--ticket-key is required and must be non-empty');

  const agent = getArg(argv, '--agent');
  if (!agent || !RESOLVE_AGENTS.includes(agent as ResolveAgent)) {
    throw new UsageError(`--agent must be one of: ${RESOLVE_AGENTS.join(', ')}`);
  }

  const kind = getArg(argv, '--kind');
  if (!kind || !RESOLVE_KINDS.includes(kind as ResolveKind)) {
    throw new UsageError(`--kind must be one of: ${RESOLVE_KINDS.join(', ')}`);
  }

  return {
    repoRoot: getArg(argv, '--repo-root') || process.env.GITHUB_WORKSPACE || process.cwd(),
    ticketKey,
    agent: agent as ResolveAgent,
    kind: kind as ResolveKind,
    fallbackId: getArg(argv, '--fallback-id') ?? '',
    outputName: getArg(argv, '--output-name') || 'transition_id',
  };
}

/** A single-line GitHub Actions step-output entry (`name=value`). */
export function formatGithubOutput(name: string, value: string): string {
  return `${name}=${value}\n`;
}
