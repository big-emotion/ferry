export type LlmProvider = 'openai' | 'anthropic';

export interface LlmRoute {
  provider: LlmProvider;
  model: string;
}

export interface FerryLlmConfig {
  default: LlmRoute;
  critical: LlmRoute;
}

import { FerryError } from '../error.js';

function parseJsonEnv(name: string): unknown {
  const raw = process.env[name];
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isProvider(x: unknown): x is LlmProvider {
  return x === 'openai' || x === 'anthropic';
}

function isRoute(x: unknown): x is LlmRoute {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return isProvider(r.provider) && typeof r.model === 'string' && r.model.length > 0;
}

function isConfig(x: unknown): x is FerryLlmConfig {
  if (!x || typeof x !== 'object') return false;
  const c = x as Record<string, unknown>;
  return isRoute(c.default) && isRoute(c.critical);
}

export function loadFerryLlmConfig(): FerryLlmConfig {
  const data = parseJsonEnv('FERRY_LLM_CONFIG');
  if (!isConfig(data)) {
    throw new FerryError('state-invariant', {
      reason: 'invalid-llm-config',
    });
  }
  return data;
}

export function selectLlmRoute(opts: { critical?: boolean }): LlmRoute {
  const cfg = loadFerryLlmConfig();
  return opts.critical ? cfg.critical : cfg.default;
}
