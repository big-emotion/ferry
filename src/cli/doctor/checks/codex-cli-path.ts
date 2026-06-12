import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { listRepoSecrets } from './secrets.js';
import { loadFerryConfig } from '../../../lib/config.js';
import type { CheckResult } from '../types.js';

const _require = createRequire(import.meta.url);

const LABEL = 'Codex-cli path';
const PROVIDER_GATE_LABEL = 'Codex path: provider gate';
const WORKFLOW_SHAPE_LABEL = 'Codex path: workflow shape';
const API_KEY_SECRET = 'OPENAI_API_KEY';

const WORKFLOW_FILES = [
  'ferry-refine.yml',
  'ferry-dev.yml',
  'ferry-review.yml',
  'ferry-iterate.yml',
  'ferry-merge.yml',
];

export type ExecutionPath = 'script' | 'codex-cli';

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

export function resolveExecutionPath(repoRoot: string): ExecutionPath {
  const raw = readConfigRaw(repoRoot);
  if (!raw) return 'script';
  return raw.execution_path === 'codex-cli' ? 'codex-cli' : 'script';
}

export async function checkCodexCliPath(opts: {
  repoRoot: string;
  repo?: string;
  openaiApiKey?: string;
}): Promise<CheckResult> {
  const { repoRoot, repo, openaiApiKey } = opts;
  const path = resolveExecutionPath(repoRoot);

  if (path !== 'codex-cli') {
    return {
      label: LABEL,
      status: 'skip',
      detail: `execution_path = script — ${API_KEY_SECRET} not required for the bundled-script path`,
    };
  }

  if ((openaiApiKey ?? '').trim()) {
    return {
      label: LABEL,
      status: 'green',
      detail: `execution_path = codex-cli; ${API_KEY_SECRET} present`,
    };
  }

  const secrets = repo ? listRepoSecrets(repo) : [];
  if (secrets.includes(API_KEY_SECRET)) {
    return {
      label: LABEL,
      status: 'green',
      detail: `execution_path = codex-cli; ${API_KEY_SECRET} present in repo secrets (value not verifiable locally)`,
    };
  }

  return {
    label: LABEL,
    status: 'red',
    detail: `execution_path = codex-cli but ${API_KEY_SECRET} is not set — the codex-cli path cannot authenticate`,
    remedy: `Set \`${API_KEY_SECRET}\` with \`gh secret set ${API_KEY_SECRET} --repo ${repo ?? '<owner/repo>'}\`, or change execution_path to "script" in ferry.config.json`,
  };
}

export function checkProviderGate(opts: { repoRoot: string }): CheckResult {
  const { repoRoot } = opts;
  const path = resolveExecutionPath(repoRoot);
  if (path !== 'codex-cli') {
    return {
      label: PROVIDER_GATE_LABEL,
      status: 'skip',
      detail: 'execution_path = script — provider gate not applicable',
    };
  }

  try {
    const cfg = loadFerryConfig(repoRoot);
    const invalid: string[] = [];
    for (const role of ['refiner', 'dev', 'review', 'iterate', 'merger'] as const) {
      const provider = cfg.models?.[role]?.provider;
      if (provider && provider !== 'openai') invalid.push(role);
    }

    if (invalid.length === 0) {
      return {
        label: PROVIDER_GATE_LABEL,
        status: 'green',
        detail: 'All configured codex-cli agents use the OpenAI provider',
      };
    }

    return {
      label: PROVIDER_GATE_LABEL,
      status: 'red',
      detail: `Non-OpenAI providers configured for codex-cli: ${invalid.join(', ')}. The runtime resolver will force the script path for those agents.`,
      remedy: `Set the listed providers to 'openai', or change execution_path to 'script'.`,
    };
  } catch {
    return {
      label: PROVIDER_GATE_LABEL,
      status: 'yellow',
      detail: 'ferry.config.* could not be parsed; codex-cli provider gate could not be verified',
    };
  }
}

export function checkWorkflowShape(opts: { repoRoot: string }): CheckResult {
  const { repoRoot } = opts;
  const path = resolveExecutionPath(repoRoot);
  if (path !== 'codex-cli') {
    return {
      label: WORKFLOW_SHAPE_LABEL,
      status: 'skip',
      detail: 'execution_path = script — workflow shape check not applicable',
    };
  }

  const stale: string[] = [];
  for (const file of WORKFLOW_FILES) {
    const workflowPath = join(repoRoot, '.github', 'workflows', file);
    if (!existsSync(workflowPath)) continue;
    const content = readFileSync(workflowPath, 'utf8');
    if (!content.includes('run-agent-codex-cli:') || !content.includes('openai/codex-action@')) {
      stale.push(file);
    }
  }

  if (stale.length === 0) {
    return {
      label: WORKFLOW_SHAPE_LABEL,
      status: 'green',
      detail: 'All codex-cli workflows contain run-agent-codex-cli backed by openai/codex-action',
    };
  }

  return {
    label: WORKFLOW_SHAPE_LABEL,
    status: 'yellow',
    detail: `These workflows are missing the run-agent-codex-cli / openai-codex-action job shape: ${stale.join(', ')}`,
    remedy: 'Run `npx -p @big-emotion/ferry ferry-update` to regenerate the workflow stubs.',
  };
}
