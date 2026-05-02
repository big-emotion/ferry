import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { CheckResult } from '../types.js';

const _require = createRequire(import.meta.url);

const MAX_ITERATIONS_SOFT_CEILING = 10;

export function checkConfigLimits(opts: { repoRoot: string }): CheckResult {
  const { repoRoot } = opts;

  const jsonPath = join(repoRoot, 'ferry.config.json');
  const yamlPath = existsSync(join(repoRoot, 'ferry.config.yaml'))
    ? join(repoRoot, 'ferry.config.yaml')
    : join(repoRoot, 'ferry.config.yml');

  const hasJson = existsSync(jsonPath);
  const hasYaml = !hasJson && existsSync(yamlPath);

  if (!hasJson && !hasYaml) {
    return {
      label: 'Config limits',
      status: 'green',
      detail: 'No ferry.config.* found — using defaults (limits.max_iterations: 3)',
    };
  }

  if (hasYaml) {
    return {
      label: 'Config limits',
      status: 'skip',
      detail: 'YAML config detected — limit checks only run for ferry.config.json',
    };
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return {
      label: 'Config limits',
      status: 'yellow',
      detail: 'ferry.config.json could not be parsed — skipping limit checks',
      remedy: 'Ensure ferry.config.json contains valid JSON',
    };
  }

  const limits = raw.limits as Record<string, unknown> | undefined;
  if (!limits || typeof limits['max_iterations'] === 'undefined') {
    return {
      label: 'Config limits',
      status: 'green',
      detail: 'limits.max_iterations not set — using default (3)',
    };
  }

  const val = limits['max_iterations'];

  if (typeof val !== 'number' || !Number.isInteger(val) || val < 1) {
    return {
      label: 'Config limits',
      status: 'red',
      detail: `limits.max_iterations must be a positive integer, got: ${String(val)}`,
      remedy: 'Set limits.max_iterations to a positive integer in the range 1–10',
    };
  }

  if (val > MAX_ITERATIONS_SOFT_CEILING) {
    return {
      label: 'Config limits',
      status: 'yellow',
      detail: `limits.max_iterations = ${val} is unusually high (recommended: 1–${MAX_ITERATIONS_SOFT_CEILING}). High values risk runaway review cycles.`,
      remedy: `Consider lowering limits.max_iterations to ${MAX_ITERATIONS_SOFT_CEILING} or below`,
    };
  }

  return {
    label: 'Config limits',
    status: 'green',
    detail: `limits.max_iterations = ${val} (within recommended range 1–${MAX_ITERATIONS_SOFT_CEILING})`,
  };
}

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

export function checkGitConfig(opts: { repoRoot: string }): CheckResult {
  const { repoRoot } = opts;
  const raw = readConfigRaw(repoRoot);

  if (!raw) {
    return {
      label: 'Git branch config',
      status: 'green',
      detail:
        'No ferry.config.* found — using defaults (base_branch resolved from repo at runtime, prefix: ferry/)',
    };
  }

  const git = raw.git as Record<string, unknown> | undefined;
  if (!git) {
    return {
      label: 'Git branch config',
      status: 'green',
      detail:
        'git section not set — using defaults (base_branch resolved from repo at runtime, prefix: ferry/)',
    };
  }

  if (typeof git !== 'object' || Array.isArray(git)) {
    return {
      label: 'Git branch config',
      status: 'red',
      detail: 'git: must be an object',
      remedy: 'Check ferry.config.* — the git section must be an object',
    };
  }

  const problems: string[] = [];

  const baseBranch = git['base_branch'];
  if (baseBranch !== undefined && baseBranch !== null) {
    if (typeof baseBranch !== 'string' || baseBranch.trim() === '') {
      problems.push('git.base_branch must be a non-empty string or null');
    }
  }

  const targetBranch = git['target_branch'];
  if (targetBranch !== undefined && targetBranch !== null) {
    if (typeof targetBranch !== 'string' || targetBranch.trim() === '') {
      problems.push('git.target_branch must be a non-empty string or null');
    }
  }

  const prefix = git['working_branch_prefix'];
  if (prefix !== undefined) {
    if (typeof prefix !== 'string' || prefix.length === 0) {
      problems.push('git.working_branch_prefix must be a non-empty string');
    }
  }

  if (problems.length > 0) {
    return {
      label: 'Git branch config',
      status: 'red',
      detail: problems.join('; '),
      remedy: 'Fix the git section in ferry.config.*',
    };
  }

  const parts: string[] = [];
  if (typeof baseBranch === 'string') parts.push(`base_branch: ${baseBranch}`);
  else parts.push('base_branch: (resolved from repo default at runtime)');
  if (typeof targetBranch === 'string') parts.push(`target_branch: ${targetBranch}`);
  else parts.push('target_branch: (same as base_branch)');
  if (typeof prefix === 'string') parts.push(`prefix: ${prefix}`);
  else parts.push('prefix: ferry/');

  return {
    label: 'Git branch config',
    status: 'green',
    detail: parts.join(', '),
  };
}
