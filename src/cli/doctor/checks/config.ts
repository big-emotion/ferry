import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckResult } from '../types.js';

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
