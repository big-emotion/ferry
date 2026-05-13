/**
 * Forge detection shared across `ferry-init`, `ferry-doctor`, `ferry-update`,
 * `ferry-uninstall`. The explicit `--forge` flag wins; otherwise the forge is
 * inferred from `git remote get-url origin`.
 *
 * GitLab paths in the four CLIs are scaffolded behind this boundary but the
 * deep wizards / probes are tracked under #214 for follow-up — when GitLab is
 * resolved and an implementation is missing, the CLI prints an actionable
 * pointer to `examples/consumer-setup-gitlab/` rather than silently breaking.
 */
import { execSync } from 'node:child_process';

export type ForgeKind = 'github' | 'gitlab';

export const FORGE_HELP =
  'Use --forge github (default) or --forge gitlab. Run with --forge gitlab to scaffold a GitLab project (experimental — see https://github.com/big-emotion/ferry/issues/210).';

const GITHUB_REMOTE = /github\.com[:/]([^/]+\/[^/.]+)/;
const GITLAB_REMOTE = /gitlab\.com[:/]([^/]+\/[^/.]+)/;

/**
 * Parse `--forge <value>` from argv. Returns `undefined` when absent so callers
 * can fall back to auto-detection.
 *
 * Throws when the value is unrecognised (rejecting silently would hide typos).
 */
export function parseForgeFlag(argv: readonly string[]): ForgeKind | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--forge') {
      const value = argv[i + 1];
      if (!value) throw new Error(`--forge requires a value. ${FORGE_HELP}`);
      return normaliseForge(value);
    }
    if (arg.startsWith('--forge=')) {
      return normaliseForge(arg.slice('--forge='.length));
    }
  }
  return undefined;
}

function normaliseForge(value: string): ForgeKind {
  const v = value.trim().toLowerCase();
  if (v === 'github' || v === 'gitlab') return v;
  throw new Error(`Unknown forge value: ${value}. ${FORGE_HELP}`);
}

/**
 * Inspect `git remote get-url origin` and classify the host. Pure when given
 * an explicit remote string; otherwise reads from the current working dir.
 */
export function detectForgeFromGit(remoteOverride?: string): ForgeKind | undefined {
  const remote = remoteOverride ?? readOriginRemote();
  if (!remote) return undefined;
  if (GITHUB_REMOTE.test(remote)) return 'github';
  if (GITLAB_REMOTE.test(remote)) return 'gitlab';
  // Self-managed GitLab instances usually expose a slug containing "/gitlab/"
  // in their remote URL — match conservatively.
  if (/\/gitlab[./]/.test(remote)) return 'gitlab';
  return undefined;
}

function readOriginRemote(): string | undefined {
  try {
    return execSync('git remote get-url origin', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Resolve the effective forge: explicit flag → auto-detect → default github.
 * Always returns a `ForgeKind` (never undefined) so callers can dispatch
 * exhaustively.
 */
export function resolveForgeFromArgv(argv: readonly string[]): ForgeKind {
  return parseForgeFlag(argv) ?? detectForgeFromGit() ?? 'github';
}
