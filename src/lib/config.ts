import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { FerryError } from './errors/index.js';

const _require = createRequire(import.meta.url);

export interface LlmRoute {
  provider: 'anthropic' | 'openai' | 'google';
  model: string;
}

export interface FerryConfig {
  models: {
    refiner: LlmRoute;
    dev: LlmRoute;
    review: LlmRoute;
    iterate: LlmRoute;
  };
  limits: {
    /** Iterator oscillation cap — throws after this many review→iterate cycles */
    max_iterations: number;
    /** Internal LLM agent loop iteration cap per single agent run */
    max_agent_iterations: number;
    /** Input token budget per agent run */
    max_tokens_per_run: number;
    /** Maximum output tokens per LLM API call */
    max_tokens_per_message: number;
    /** Cost budget in EUR per run */
    max_cost_eur_per_run: number;
  };
  ticket_types: {
    refine_allowlist: string[];
    dev_allowlist: string[];
  };
}

export const DEFAULT_FERRY_CONFIG: FerryConfig = {
  models: {
    refiner: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    dev: { provider: 'anthropic', model: 'claude-opus-4-5' },
    review: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    iterate: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  },
  limits: {
    max_iterations: 3,
    max_agent_iterations: 200,
    max_tokens_per_run: 500_000,
    max_tokens_per_message: 16_384,
    max_cost_eur_per_run: 10,
  },
  ticket_types: {
    refine_allowlist: ['Story', 'Bug', 'Spike'],
    dev_allowlist: ['Story', 'Bug', 'Spike'],
  },
};

// --- Validation helpers ---

type ValidationError = string;

function validateProvider(val: unknown, fieldPath: string): ValidationError[] {
  if (val !== 'anthropic' && val !== 'openai' && val !== 'google') {
    return [`${fieldPath}: must be "anthropic", "openai", or "google"`];
  }
  return [];
}

function validateLlmRoute(val: unknown, fieldPath: string): ValidationError[] {
  if (!val || typeof val !== 'object') return [`${fieldPath}: must be an object`];
  const r = val as Record<string, unknown>;
  return [
    ...validateProvider(r.provider, `${fieldPath}.provider`),
    ...(typeof r.model !== 'string' || r.model.length === 0
      ? [`${fieldPath}.model: must be a non-empty string`]
      : []),
  ];
}

function validatePosInt(val: unknown, fieldPath: string): ValidationError[] {
  if (typeof val !== 'number' || !Number.isInteger(val) || val <= 0) {
    return [`${fieldPath}: must be a positive integer`];
  }
  return [];
}

function validatePosNumber(val: unknown, fieldPath: string): ValidationError[] {
  if (typeof val !== 'number' || val <= 0) {
    return [`${fieldPath}: must be a positive number`];
  }
  return [];
}

function validateStringArray(val: unknown, fieldPath: string): ValidationError[] {
  if (!Array.isArray(val) || val.some((v) => typeof v !== 'string')) {
    return [`${fieldPath}: must be an array of strings`];
  }
  return [];
}

function validateConfigShape(raw: unknown): ValidationError[] {
  if (!raw || typeof raw !== 'object') return ['config: must be an object'];
  const c = raw as Record<string, unknown>;
  const errs: ValidationError[] = [];

  if (c.models !== undefined) {
    if (!c.models || typeof c.models !== 'object') {
      errs.push('models: must be an object');
    } else {
      const m = c.models as Record<string, unknown>;
      for (const key of ['refiner', 'dev', 'review', 'iterate'] as const) {
        if (m[key] !== undefined) {
          errs.push(...validateLlmRoute(m[key], `models.${String(key)}`));
        }
      }
    }
  }

  if (c.limits !== undefined) {
    if (!c.limits || typeof c.limits !== 'object') {
      errs.push('limits: must be an object');
    } else {
      const l = c.limits as Record<string, unknown>;
      if (l.max_iterations !== undefined) errs.push(...validatePosInt(l.max_iterations, 'limits.max_iterations'));
      if (l.max_agent_iterations !== undefined) errs.push(...validatePosInt(l.max_agent_iterations, 'limits.max_agent_iterations'));
      if (l.max_tokens_per_run !== undefined) errs.push(...validatePosInt(l.max_tokens_per_run, 'limits.max_tokens_per_run'));
      if (l.max_tokens_per_message !== undefined) errs.push(...validatePosInt(l.max_tokens_per_message, 'limits.max_tokens_per_message'));
      if (l.max_cost_eur_per_run !== undefined) errs.push(...validatePosNumber(l.max_cost_eur_per_run, 'limits.max_cost_eur_per_run'));
    }
  }

  if (c.ticket_types !== undefined) {
    if (!c.ticket_types || typeof c.ticket_types !== 'object') {
      errs.push('ticket_types: must be an object');
    } else {
      const t = c.ticket_types as Record<string, unknown>;
      if (t.refine_allowlist !== undefined) errs.push(...validateStringArray(t.refine_allowlist, 'ticket_types.refine_allowlist'));
      if (t.dev_allowlist !== undefined) errs.push(...validateStringArray(t.dev_allowlist, 'ticket_types.dev_allowlist'));
    }
  }

  return errs;
}

// --- File reading ---

type RawConfig = Record<string, unknown>;

function readJsonConfig(filePath: string): RawConfig {
  const raw = readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw) as RawConfig;
  } catch (e) {
    throw new FerryError('state-invariant', {
      reason: 'invalid-ferry-config',
      file: path.basename(filePath),
      error: (e as Error).message,
    });
  }
}

function readYamlConfig(filePath: string): RawConfig {
  // Requires the `yaml` npm package: npm install yaml
  let parseYaml: (s: string) => unknown;
  try {
    const mod = _require('yaml') as { parse: (s: string) => unknown };
    parseYaml = mod.parse;
  } catch {
    throw new FerryError('state-invariant', {
      reason: 'invalid-ferry-config',
      file: path.basename(filePath),
      error: 'YAML config requires the "yaml" package: npm install yaml',
    });
  }
  const raw = readFileSync(filePath, 'utf8');
  try {
    return parseYaml(raw) as RawConfig;
  } catch (e) {
    throw new FerryError('state-invariant', {
      reason: 'invalid-ferry-config',
      file: path.basename(filePath),
      error: (e as Error).message,
    });
  }
}

function findAndReadConfigFile(repoRoot: string): RawConfig | null {
  const candidates: Array<{ file: string; reader: (p: string) => RawConfig }> = [
    { file: 'ferry.config.json', reader: readJsonConfig },
    { file: 'ferry.config.yaml', reader: readYamlConfig },
    { file: 'ferry.config.yml', reader: readYamlConfig },
  ];

  for (const { file, reader } of candidates) {
    const filePath = path.join(repoRoot, file);
    if (!existsSync(filePath)) continue;
    return reader(filePath);
  }
  return null;
}

// --- Merging ---

function mergeWithDefaults(raw: RawConfig): FerryConfig {
  const m = (raw.models ?? {}) as Record<string, unknown>;
  const l = (raw.limits ?? {}) as Record<string, unknown>;
  const t = (raw.ticket_types ?? {}) as Record<string, unknown>;

  const route = (val: unknown, def: LlmRoute): LlmRoute => {
    if (!val || typeof val !== 'object') return def;
    const r = val as Record<string, unknown>;
    return {
      provider: (r.provider as LlmRoute['provider']) ?? def.provider,
      model: (r.model as string) ?? def.model,
    };
  };

  const num = (val: unknown, def: number): number =>
    typeof val === 'number' ? val : def;
  const strArr = (val: unknown, def: string[]): string[] =>
    Array.isArray(val) ? (val as string[]) : def;

  return {
    models: {
      refiner: route(m.refiner, DEFAULT_FERRY_CONFIG.models.refiner),
      dev: route(m.dev, DEFAULT_FERRY_CONFIG.models.dev),
      review: route(m.review, DEFAULT_FERRY_CONFIG.models.review),
      iterate: route(m.iterate, DEFAULT_FERRY_CONFIG.models.iterate),
    },
    limits: {
      max_iterations: num(l.max_iterations, DEFAULT_FERRY_CONFIG.limits.max_iterations),
      max_agent_iterations: num(l.max_agent_iterations, DEFAULT_FERRY_CONFIG.limits.max_agent_iterations),
      max_tokens_per_run: num(l.max_tokens_per_run, DEFAULT_FERRY_CONFIG.limits.max_tokens_per_run),
      max_tokens_per_message: num(l.max_tokens_per_message, DEFAULT_FERRY_CONFIG.limits.max_tokens_per_message),
      max_cost_eur_per_run: num(l.max_cost_eur_per_run, DEFAULT_FERRY_CONFIG.limits.max_cost_eur_per_run),
    },
    ticket_types: {
      refine_allowlist: strArr(t.refine_allowlist, DEFAULT_FERRY_CONFIG.ticket_types.refine_allowlist),
      dev_allowlist: strArr(t.dev_allowlist, DEFAULT_FERRY_CONFIG.ticket_types.dev_allowlist),
    },
  };
}

// --- Env var overrides ---

function applyEnvOverrides(cfg: FerryConfig): FerryConfig {
  const models = { ...cfg.models };
  const limits = { ...cfg.limits };

  if (process.env.FERRY_DEV_MODEL) {
    models.dev = { ...models.dev, model: process.env.FERRY_DEV_MODEL };
  }
  if (process.env.FERRY_REVIEW_MODEL) {
    models.review = { ...models.review, model: process.env.FERRY_REVIEW_MODEL };
  }
  if (process.env.FERRY_ITER_MODEL) {
    models.iterate = { ...models.iterate, model: process.env.FERRY_ITER_MODEL };
  }

  const maxAgentIter = parseInt(process.env.FERRY_DEV_MAX_ITERATIONS ?? '', 10);
  if (Number.isFinite(maxAgentIter)) limits.max_agent_iterations = maxAgentIter;

  const maxInputTok = parseInt(process.env.FERRY_DEV_MAX_INPUT_TOKENS ?? '', 10);
  if (Number.isFinite(maxInputTok)) limits.max_tokens_per_run = maxInputTok;

  const maxTok = parseInt(process.env.FERRY_DEV_MAX_TOKENS ?? '', 10);
  if (Number.isFinite(maxTok)) limits.max_tokens_per_message = maxTok;

  const maxCost = parseFloat(process.env.FERRY_MAX_COST_EUR_PER_RUN ?? '');
  if (Number.isFinite(maxCost)) limits.max_cost_eur_per_run = maxCost;

  return { ...cfg, models, limits };
}

// --- Public API ---

export function loadFerryConfig(repoRoot?: string): FerryConfig {
  const root = repoRoot ?? process.env.GITHUB_WORKSPACE ?? process.cwd();
  const raw = findAndReadConfigFile(root);

  if (raw === null) {
    return applyEnvOverrides(DEFAULT_FERRY_CONFIG);
  }

  const errors = validateConfigShape(raw);
  if (errors.length > 0) {
    throw new FerryError('state-invariant', {
      reason: 'invalid-ferry-config',
      errors,
    });
  }

  return applyEnvOverrides(mergeWithDefaults(raw));
}
