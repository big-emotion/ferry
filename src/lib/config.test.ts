import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { loadFerryConfig, DEFAULT_FERRY_CONFIG } from './config.js';
import { FerryError } from './errors/index.js';

const { mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(p: unknown) => boolean>(),
  mockReadFileSync: vi.fn<(p: unknown, enc?: unknown) => string>(),
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

function mockConfigFile(filename: string, content: string): void {
  mockExistsSync.mockImplementation((p) => {
    return typeof p === 'string' && path.basename(p) === filename;
  });
  mockReadFileSync.mockImplementation((p) => {
    if (typeof p === 'string' && path.basename(p) === filename) return content;
    throw new Error(`ENOENT: no such file or directory, open '${String(p)}'`);
  });
}

function mockNoConfigFile(): void {
  mockExistsSync.mockReturnValue(false);
}

describe('loadFerryConfig', () => {
  beforeEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('zero-config (no file)', () => {
    it('returns defaults when no config file exists', () => {
      mockNoConfigFile();
      const cfg = loadFerryConfig('/repo');
      expect(cfg).toEqual(DEFAULT_FERRY_CONFIG);
    });

    it('defaults include all four models', () => {
      mockNoConfigFile();
      const cfg = loadFerryConfig('/repo');
      expect(cfg.models.refiner.model).toBe('claude-sonnet-4-6');
      expect(cfg.models.dev.model).toBe('claude-opus-4-5');
      expect(cfg.models.review.model).toBe('claude-sonnet-4-6');
      expect(cfg.models.iterate.model).toBe('claude-sonnet-4-6');
    });

    it('defaults include oscillation cap of 3', () => {
      mockNoConfigFile();
      const cfg = loadFerryConfig('/repo');
      expect(cfg.limits.max_iterations).toBe(3);
    });

    it('defaults include ticket type allowlists', () => {
      mockNoConfigFile();
      const cfg = loadFerryConfig('/repo');
      expect(cfg.ticket_types.refine_allowlist).toEqual(['Story', 'Bug', 'Spike']);
      expect(cfg.ticket_types.dev_allowlist).toEqual(['Story', 'Bug', 'Spike']);
    });
  });

  describe('JSON config file', () => {
    it('loads and merges a partial JSON config', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({
          models: { dev: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' } },
        }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.models.dev.model).toBe('claude-haiku-4-5-20251001');
      expect(cfg.models.review.model).toBe(DEFAULT_FERRY_CONFIG.models.review.model);
    });

    it('loads limits from JSON config', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ limits: { max_iterations: 5, max_tokens_per_run: 200000 } }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.limits.max_iterations).toBe(5);
      expect(cfg.limits.max_tokens_per_run).toBe(200000);
      expect(cfg.limits.max_agent_iterations).toBe(
        DEFAULT_FERRY_CONFIG.limits.max_agent_iterations,
      );
    });

    it('loads ticket_types allowlists from JSON config', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ ticket_types: { refine_allowlist: ['Story'], dev_allowlist: ['Bug'] } }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.ticket_types.refine_allowlist).toEqual(['Story']);
      expect(cfg.ticket_types.dev_allowlist).toEqual(['Bug']);
    });

    it('throws on invalid JSON syntax', () => {
      mockConfigFile('ferry.config.json', '{ bad json }');
      expect(() => loadFerryConfig('/repo')).toThrow(FerryError);
    });

    it('throws on invalid config shape with descriptive errors', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ models: { dev: { provider: 'bad-provider', model: '' } } }),
      );
      expect(() => loadFerryConfig('/repo')).toThrowError(/invalid-ferry-config/);
    });

    it('throws with field path in error for invalid provider', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ models: { dev: { provider: 'unknown', model: 'x' } } }),
      );
      let thrown: FerryError | null = null;
      try {
        loadFerryConfig('/repo');
      } catch (e) {
        thrown = e as FerryError;
      }
      expect(thrown).toBeInstanceOf(FerryError);
      const errors = thrown?.context?.errors as string[];
      expect(errors.some((e) => e.includes('models.dev.provider'))).toBe(true);
    });

    it('throws with field path in error for invalid limit type', () => {
      mockConfigFile('ferry.config.json', JSON.stringify({ limits: { max_iterations: -1 } }));
      let thrown: FerryError | null = null;
      try {
        loadFerryConfig('/repo');
      } catch (e) {
        thrown = e as FerryError;
      }
      expect(thrown).toBeInstanceOf(FerryError);
      const errors = thrown?.context?.errors as string[];
      expect(errors.some((e) => e.includes('limits.max_iterations'))).toBe(true);
    });
  });

  describe('env var overrides', () => {
    it('FERRY_DEV_MODEL overrides config file model', () => {
      mockConfigFile('ferry.config.json', JSON.stringify({}));
      vi.stubEnv('FERRY_DEV_MODEL', 'claude-haiku-4-5-20251001');
      const cfg = loadFerryConfig('/repo');
      expect(cfg.models.dev.model).toBe('claude-haiku-4-5-20251001');
    });

    it('FERRY_REVIEW_MODEL overrides config file model', () => {
      mockNoConfigFile();
      vi.stubEnv('FERRY_REVIEW_MODEL', 'claude-haiku-4-5-20251001');
      const cfg = loadFerryConfig('/repo');
      expect(cfg.models.review.model).toBe('claude-haiku-4-5-20251001');
    });

    it('FERRY_ITER_MODEL overrides config file model', () => {
      mockNoConfigFile();
      vi.stubEnv('FERRY_ITER_MODEL', 'claude-opus-4-7');
      const cfg = loadFerryConfig('/repo');
      expect(cfg.models.iterate.model).toBe('claude-opus-4-7');
    });

    it('FERRY_DEV_MAX_ITERATIONS overrides max_agent_iterations', () => {
      mockNoConfigFile();
      vi.stubEnv('FERRY_DEV_MAX_ITERATIONS', '50');
      const cfg = loadFerryConfig('/repo');
      expect(cfg.limits.max_agent_iterations).toBe(50);
    });

    it('FERRY_DEV_MAX_INPUT_TOKENS overrides max_tokens_per_run', () => {
      mockNoConfigFile();
      vi.stubEnv('FERRY_DEV_MAX_INPUT_TOKENS', '100000');
      const cfg = loadFerryConfig('/repo');
      expect(cfg.limits.max_tokens_per_run).toBe(100000);
    });

    it('FERRY_DEV_MAX_TOKENS overrides max_tokens_per_message', () => {
      mockNoConfigFile();
      vi.stubEnv('FERRY_DEV_MAX_TOKENS', '8192');
      const cfg = loadFerryConfig('/repo');
      expect(cfg.limits.max_tokens_per_message).toBe(8192);
    });

    it('FERRY_MAX_COST_EUR_PER_RUN overrides max_cost_eur_per_run', () => {
      mockNoConfigFile();
      vi.stubEnv('FERRY_MAX_COST_EUR_PER_RUN', '5.5');
      const cfg = loadFerryConfig('/repo');
      expect(cfg.limits.max_cost_eur_per_run).toBe(5.5);
    });

    it('env var takes precedence over config file value', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ models: { dev: { provider: 'anthropic', model: 'claude-opus-4-7' } } }),
      );
      vi.stubEnv('FERRY_DEV_MODEL', 'claude-haiku-4-5-20251001');
      const cfg = loadFerryConfig('/repo');
      expect(cfg.models.dev.model).toBe('claude-haiku-4-5-20251001');
    });

    it('ignores invalid (non-numeric) env var values for numeric limits', () => {
      mockNoConfigFile();
      vi.stubEnv('FERRY_DEV_MAX_ITERATIONS', 'not-a-number');
      const cfg = loadFerryConfig('/repo');
      expect(cfg.limits.max_agent_iterations).toBe(
        DEFAULT_FERRY_CONFIG.limits.max_agent_iterations,
      );
    });
  });

  describe('full config', () => {
    it('accepts a fully-specified config', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({
          models: {
            refiner: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
            dev: { provider: 'anthropic', model: 'claude-opus-4-7' },
            review: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
            iterate: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
          },
          limits: {
            max_iterations: 2,
            max_agent_iterations: 100,
            max_tokens_per_run: 300000,
            max_tokens_per_message: 8192,
            max_cost_eur_per_run: 5,
          },
          ticket_types: {
            refine_allowlist: ['Story', 'Bug'],
            dev_allowlist: ['Story', 'Bug'],
          },
        }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.models.refiner.model).toBe('claude-haiku-4-5-20251001');
      expect(cfg.models.dev.model).toBe('claude-opus-4-7');
      expect(cfg.limits.max_iterations).toBe(2);
      expect(cfg.limits.max_agent_iterations).toBe(100);
      expect(cfg.limits.max_tokens_per_run).toBe(300000);
      expect(cfg.ticket_types.refine_allowlist).toEqual(['Story', 'Bug']);
    });
  });
});
