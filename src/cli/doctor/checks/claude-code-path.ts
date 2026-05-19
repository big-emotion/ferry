import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { listRepoSecrets } from './secrets.js';
import type { CheckResult } from '../types.js';

const _require = createRequire(import.meta.url);

const LABEL = 'Claude-code path';
const OAUTH_SECRET = 'CLAUDE_CODE_OAUTH_TOKEN';

export type ExecutionPath = 'script' | 'claude-code';

function readConfigRaw(repoRoot: string): Record<string, unknown> | null {
  const jsonPath = join(repoRoot, 'ferry.config.json');
  if (existsSync(jsonPath)) {
    try {
      return JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  const yamlPath = existsSync(join(repoRoot, 'ferry.config.yaml'))
    ? join(repoRoot, 'ferry.config.yaml')
    : join(repoRoot, 'ferry.config.yml');
  if (existsSync(yamlPath)) {
    try {
      const mod = _require('yaml') as { parse: (s: string) => unknown };
      return mod.parse(readFileSync(yamlPath, 'utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Resolve the consumer's configured execution path from `ferry.config.*`.
 *
 * This reads the *explicit* `execution_path` key only. The conditional-default
 * heuristic (Anthropic-only → claude-code) lives in the routing resolver, not
 * here: `ferry-doctor` flags a missing token strictly when the consumer has
 * opted into the claude-code path explicitly (ADR-0006 §6, decisions/0002 §E).
 */
export function resolveExecutionPath(repoRoot: string): ExecutionPath {
  const raw = readConfigRaw(repoRoot);
  if (!raw) return 'script';
  return raw.execution_path === 'claude-code' ? 'claude-code' : 'script';
}

/**
 * Validity heuristic: a `claude setup-token` OAuth token is not a normal
 * Anthropic API key. ADR-0006 §6 forbids `ANTHROPIC_API_KEY` on the
 * claude-code path, so a value shaped like `sk-ant-api…` is a misconfiguration.
 */
function looksLikeApiKey(token: string): boolean {
  return /^sk-ant-api/i.test(token.trim());
}

export async function checkClaudeCodePath(opts: {
  repoRoot: string;
  repo?: string;
  claudeCodeOauthToken?: string;
}): Promise<CheckResult> {
  const { repoRoot, repo, claudeCodeOauthToken } = opts;

  const path = resolveExecutionPath(repoRoot);

  // Diagnostic only — never flag a missing token unless the consumer opted in.
  if (path !== 'claude-code') {
    return {
      label: LABEL,
      status: 'skip',
      detail: `execution_path = script — ${OAUTH_SECRET} not required for the bundled-script path`,
    };
  }

  const localToken = (claudeCodeOauthToken ?? '').trim();
  if (localToken) {
    if (looksLikeApiKey(localToken)) {
      return {
        label: LABEL,
        status: 'yellow',
        detail: `execution_path = claude-code, but ${OAUTH_SECRET} looks like an Anthropic API key — the claude-code path must use a subscription OAuth token, never ANTHROPIC_API_KEY (ADR-0006 §6)`,
        remedy: `Generate a subscription token with \`claude setup-token\`, then \`gh secret set ${OAUTH_SECRET}\``,
      };
    }
    return {
      label: LABEL,
      status: 'green',
      detail: `execution_path = claude-code; ${OAUTH_SECRET} present (subscription OAuth token)`,
    };
  }

  // No local value (the usual CI case) — `gh secret list` only exposes names.
  const secrets = repo ? listRepoSecrets(repo) : [];
  if (secrets.includes(OAUTH_SECRET)) {
    return {
      label: LABEL,
      status: 'green',
      detail: `execution_path = claude-code; ${OAUTH_SECRET} present in repo secrets (value not verifiable locally)`,
    };
  }

  return {
    label: LABEL,
    status: 'red',
    detail: `execution_path = claude-code but ${OAUTH_SECRET} is not set — the claude-code path cannot authenticate`,
    remedy: `Run \`claude setup-token\` (requires a Claude Pro/Max subscription), then \`gh secret set ${OAUTH_SECRET} --repo ${repo ?? '<owner/repo>'}\` — or set execution_path to "script" in ferry.config.json`,
  };
}
