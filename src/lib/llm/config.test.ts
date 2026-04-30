import { describe, expect, test, vi } from 'vitest';

import { FerryError } from '../errors/index.js';
import { loadFerryLlmConfig, selectLlmRoute } from './config.js';

describe('llm config', () => {
  test('loads and validates config', () => {
    vi.stubEnv(
      'FERRY_LLM_CONFIG',
      JSON.stringify({
        default: { provider: 'openai', model: 'gpt-4.1-mini' },
        critical: { provider: 'anthropic', model: 'claude-3-7-sonnet' },
      }),
    );

    const cfg = loadFerryLlmConfig();

    expect(cfg.default.provider).toBe('openai');
    expect(cfg.critical.model).toBe('claude-3-7-sonnet');
  });

  test('selects critical route when critical=true', () => {
    vi.stubEnv(
      'FERRY_LLM_CONFIG',
      JSON.stringify({
        default: { provider: 'openai', model: 'gpt-4.1-mini' },
        critical: { provider: 'anthropic', model: 'claude-3-7-sonnet' },
      }),
    );

    const route = selectLlmRoute({ critical: true });

    expect(route.provider).toBe('anthropic');
    expect(route.model).toBe('claude-3-7-sonnet');
  });

  test('selects default route when critical is not set', () => {
    vi.stubEnv(
      'FERRY_LLM_CONFIG',
      JSON.stringify({
        default: { provider: 'openai', model: 'gpt-4.1-mini' },
        critical: { provider: 'anthropic', model: 'claude-3-7-sonnet' },
      }),
    );

    const route = selectLlmRoute({});

    expect(route.provider).toBe('openai');
    expect(route.model).toBe('gpt-4.1-mini');
  });

  test('throws FerryError when config is missing', () => {
    vi.stubEnv('FERRY_LLM_CONFIG', '');

    expect(() => loadFerryLlmConfig()).toThrow(FerryError);
    expect(() => loadFerryLlmConfig()).toThrow(/\[ferry:state-invariant\]/);
  });

  test('throws FerryError when config is invalid', () => {
    vi.stubEnv(
      'FERRY_LLM_CONFIG',
      JSON.stringify({
        default: { provider: 123, model: 'x' },
        critical: { provider: 'anthropic', model: 'y' },
      }),
    );

    expect(() => loadFerryLlmConfig()).toThrow(FerryError);
    expect(() => loadFerryLlmConfig()).toThrow(/\[ferry:state-invariant\]/);
  });
});
