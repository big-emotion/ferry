import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { listRepoSecrets } from './secrets.js';
import { loadFerryConfig } from '../../../lib/config.js';
import type { CheckResult } from '../types.js';

const _require = createRequire(import.meta.url);

const LABEL = 'Claude-code path';
const EXCLUSIVITY_LABEL = 'CC path: token exclusivity';
const PROVIDER_GATE_LABEL = 'CC path: provider gate';
const WORKFLOW_SHAPE_LABEL = 'CC path: workflow shape';

const OAUTH_SECRET = 'CLAUDE_CODE_OAUTH_TOKEN';
const API_KEY_SECRET = 'ANTHROPIC_API_KEY';

const WORKFLOW_FILES = [
  'ferry-refine.yml',
  'ferry-dev.yml',
  'ferry-review.yml',
  'ferry-iterate.yml',
];

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
 * Returns true when the raw config has any model phase configured with a
 * non-Anthropic provider. Used to warn when execution_path: claude-code is set
 * alongside a mixed-provider config (ADR-0006 §1, issue #329).
 */
function hasMixedProviders(raw: Record<string, unknown>): boolean {
  const models = raw['models'] as Record<string, unknown> | undefined;
  if (!models) return false;
  for (const phase of ['refiner', 'dev', 'review', 'iterate']) {
    const phaseConf = models[phase] as Record<string, unknown> | undefined;
    if (phaseConf?.['provider'] && phaseConf['provider'] !== 'anthropic') {
      return true;
    }
  }
  return false;
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

  // Provider/path mismatch (ADR-0006 §1, issue #329): the claude-code path
  // requires an Anthropic-only config. The runtime resolver will gate to
  // 'script' (provider-gate) if any agent uses a non-Anthropic provider.
  const raw = readConfigRaw(repoRoot);
  if (raw && hasMixedProviders(raw)) {
    return {
      label: LABEL,
      status: 'yellow',
      detail: `execution_path = claude-code, but at least one agent provider is not Anthropic — the claude-code path requires an Anthropic-only config (ADR-0006 §1). The resolver will gate to 'script' at runtime (reason: provider-gate).`,
      remedy: `Set all agent providers to 'anthropic' in ferry.config, or change execution_path to 'script'.`,
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

/**
 * Check token mutual exclusion: `ANTHROPIC_API_KEY` must not be set as a repo
 * secret alongside `CLAUDE_CODE_OAUTH_TOKEN` when `execution_path = claude-code`
 * (ADR-0006 §6). Presence of both is a misconfiguration — the claude-code path
 * authenticates exclusively via the OAuth token.
 */
export async function checkTokenExclusivity(opts: {
  repoRoot: string;
  repo?: string;
}): Promise<CheckResult> {
  const { repoRoot, repo } = opts;

  const path = resolveExecutionPath(repoRoot);
  if (path !== 'claude-code') {
    return {
      label: EXCLUSIVITY_LABEL,
      status: 'skip',
      detail: `execution_path = script — token exclusivity check not applicable`,
    };
  }

  if (!repo) {
    return {
      label: EXCLUSIVITY_LABEL,
      status: 'skip',
      detail: `No repo specified — token exclusivity check skipped`,
    };
  }

  const secrets = listRepoSecrets(repo);
  const oauthPresent = secrets.includes(OAUTH_SECRET);
  const apiKeyPresent = secrets.includes(API_KEY_SECRET);

  if (!oauthPresent) {
    return {
      label: EXCLUSIVITY_LABEL,
      status: 'red',
      detail: `execution_path = claude-code but ${OAUTH_SECRET} is not set as a repo secret`,
      remedy: `Run \`claude setup-token\` (requires a Claude Pro/Max subscription), then \`gh secret set ${OAUTH_SECRET} --repo ${repo}\``,
    };
  }

  if (apiKeyPresent) {
    return {
      label: EXCLUSIVITY_LABEL,
      status: 'yellow',
      detail: `${OAUTH_SECRET} and ${API_KEY_SECRET} are both set as repo secrets — ADR-0006 §6 requires mutual exclusion; ${API_KEY_SECRET} is not needed on the claude-code path`,
      remedy: `Remove \`${API_KEY_SECRET}\` from repo secrets: \`gh secret delete ${API_KEY_SECRET} --repo ${repo}\`. On the claude-code path, authentication uses ${OAUTH_SECRET} exclusively`,
    };
  }

  return {
    label: EXCLUSIVITY_LABEL,
    status: 'green',
    detail: `${OAUTH_SECRET} present, ${API_KEY_SECRET} absent — token exclusivity satisfied (ADR-0006 §6)`,
  };
}

/**
 * Check provider gate: when `execution_path = claude-code`, all four agent
 * providers must be `anthropic` (ADR-0006 §1). A non-anthropic provider causes
 * the runtime provider gate to force the script path despite the explicit config,
 * leading to a confusing mismatch between config intent and actual behavior.
 */
export function checkProviderGate(opts: { repoRoot: string }): CheckResult {
  const { repoRoot } = opts;

  const path = resolveExecutionPath(repoRoot);
  if (path !== 'claude-code') {
    return {
      label: PROVIDER_GATE_LABEL,
      status: 'skip',
      detail: `execution_path = script — provider gate check not applicable`,
    };
  }

  let cfg: ReturnType<typeof loadFerryConfig>;
  try {
    cfg = loadFerryConfig(repoRoot);
  } catch {
    return {
      label: PROVIDER_GATE_LABEL,
      status: 'yellow',
      detail: `ferry.config.* could not be parsed — provider gate check skipped`,
      remedy: `Ensure ferry.config.json/yaml contains valid configuration`,
    };
  }

  const models = cfg.models;
  const nonAnthropicAgents = (['refiner', 'dev', 'review', 'iterate'] as const).filter(
    (key) => models[key].provider !== 'anthropic',
  );

  if (nonAnthropicAgents.length > 0) {
    const agentList = nonAnthropicAgents.join(', ');
    const verb = nonAnthropicAgents.length === 1 ? 'is' : 'are';
    return {
      label: PROVIDER_GATE_LABEL,
      status: 'red',
      detail: `execution_path = claude-code requires all four agent providers to be anthropic, but ${agentList} ${verb} configured with a non-anthropic provider — the provider gate will force the script path at runtime, conflicting with the explicit config`,
      remedy: `Set all four agent providers to anthropic in ferry.config.* (or switch to execution_path: script for multi-provider setups) — see ADR-0006 §1`,
    };
  }

  return {
    label: PROVIDER_GATE_LABEL,
    status: 'green',
    detail: `All four agent providers are anthropic — provider gate satisfied for claude-code path (ADR-0006 §1)`,
  };
}

/**
 * Check workflow shape: when `execution_path = claude-code`, the four consumer
 * workflows must include the v0.13.0 claude-code chain
 * (ferry-cc-prepare + anthropics/claude-code-action@v1 + ferry-cc-apply).
 * Workflows with the v0.12.x placeholder are stale and need `ferry-update`.
 */
export function checkWorkflowShape(opts: { repoRoot: string }): CheckResult {
  const { repoRoot } = opts;

  const path = resolveExecutionPath(repoRoot);
  if (path !== 'claude-code') {
    return {
      label: WORKFLOW_SHAPE_LABEL,
      status: 'skip',
      detail: `execution_path = script — workflow shape check not applicable`,
    };
  }

  const workflowDir = join(repoRoot, '.github', 'workflows');
  const stale: string[] = [];
  const missingChain: string[] = [];

  for (const filename of WORKFLOW_FILES) {
    const filePath = join(workflowDir, filename);
    if (!existsSync(filePath)) {
      // Missing workflow files are flagged by the "Workflow files" check — skip here.
      continue;
    }
    const content = readFileSync(filePath, 'utf8');

    if (/claude-code execution path not yet wired/.test(content)) {
      stale.push(filename);
      continue;
    }

    const hasCcChain =
      /anthropics\/claude-code-action@/.test(content) &&
      /ferry-cc-prepare/.test(content) &&
      /ferry-cc-apply/.test(content);

    if (!hasCcChain) {
      missingChain.push(filename);
    }
  }

  if (stale.length > 0) {
    const fileList = stale.join(', ');
    return {
      label: WORKFLOW_SHAPE_LABEL,
      status: 'yellow',
      detail: `${stale.length} workflow file(s) still contain the v0.12.x claude-code placeholder (not yet wired): ${fileList}`,
      remedy: `Run \`npx -p @big-emotion/ferry ferry-update\` to upgrade to the v0.13.0 workflow shape (ferry-cc-prepare + claude-code-action + ferry-cc-apply) — see MIGRATIONS.md for details`,
    };
  }

  if (missingChain.length > 0) {
    const fileList = missingChain.join(', ');
    return {
      label: WORKFLOW_SHAPE_LABEL,
      status: 'yellow',
      detail: `${missingChain.length} workflow file(s) are missing the v0.13.0 claude-code chain (ferry-cc-prepare + anthropics/claude-code-action@v1 + ferry-cc-apply): ${fileList}`,
      remedy: `Run \`npx -p @big-emotion/ferry ferry-update\` to upgrade to the v0.13.0 workflow shape — see MIGRATIONS.md for details`,
    };
  }

  return {
    label: WORKFLOW_SHAPE_LABEL,
    status: 'green',
    detail: `All four workflow files include the v0.13.0 claude-code chain (ferry-cc-prepare + claude-code-action + ferry-cc-apply)`,
  };
}
