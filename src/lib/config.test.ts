import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFerryConfig, parseFerryConfigJson, DEFAULT_FERRY_CONFIG } from './config.js';
import { FerryError } from './errors/index.js';
import { shouldSkipForTaskType } from './dispatch/routing.js';

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
      expect(cfg.models.refiner.model).toBe('claude-opus-4-8');
      expect(cfg.models.dev.model).toBe('claude-sonnet-5');
      expect(cfg.models.review.model).toBe('claude-opus-4-8');
      expect(cfg.models.iterate.model).toBe('claude-sonnet-5');
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
    it('FERRY_REFINER_PROVIDER overrides config file provider', () => {
      mockNoConfigFile();
      vi.stubEnv('FERRY_REFINER_PROVIDER', 'openai');
      const cfg = loadFerryConfig('/repo');
      expect(cfg.models.refiner.provider).toBe('openai');
    });

    it('FERRY_REFINER_MODEL overrides config file model', () => {
      mockNoConfigFile();
      vi.stubEnv('FERRY_REFINER_MODEL', 'gpt-4.1');
      const cfg = loadFerryConfig('/repo');
      expect(cfg.models.refiner.model).toBe('gpt-4.1');
    });

    it('FERRY_DEV_PROVIDER overrides config file provider', () => {
      mockNoConfigFile();
      vi.stubEnv('FERRY_DEV_PROVIDER', 'google');
      const cfg = loadFerryConfig('/repo');
      expect(cfg.models.dev.provider).toBe('google');
    });

    it('FERRY_DEV_MODEL overrides config file model', () => {
      mockConfigFile('ferry.config.json', JSON.stringify({}));
      vi.stubEnv('FERRY_DEV_MODEL', 'claude-haiku-4-5-20251001');
      const cfg = loadFerryConfig('/repo');
      expect(cfg.models.dev.model).toBe('claude-haiku-4-5-20251001');
    });

    it('FERRY_REVIEW_PROVIDER overrides config file provider', () => {
      mockNoConfigFile();
      vi.stubEnv('FERRY_REVIEW_PROVIDER', 'openai');
      const cfg = loadFerryConfig('/repo');
      expect(cfg.models.review.provider).toBe('openai');
    });

    it('FERRY_REVIEW_MODEL overrides config file model', () => {
      mockNoConfigFile();
      vi.stubEnv('FERRY_REVIEW_MODEL', 'claude-haiku-4-5-20251001');
      const cfg = loadFerryConfig('/repo');
      expect(cfg.models.review.model).toBe('claude-haiku-4-5-20251001');
    });

    it('FERRY_ITER_PROVIDER overrides config file provider', () => {
      mockNoConfigFile();
      vi.stubEnv('FERRY_ITER_PROVIDER', 'google');
      const cfg = loadFerryConfig('/repo');
      expect(cfg.models.iterate.provider).toBe('google');
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

    it('ignores unknown FERRY_REFINER_PROVIDER values', () => {
      mockNoConfigFile();
      vi.stubEnv('FERRY_REFINER_PROVIDER', 'unknown-provider');
      const cfg = loadFerryConfig('/repo');
      expect(cfg.models.refiner.provider).toBe(DEFAULT_FERRY_CONFIG.models.refiner.provider);
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

  describe('git section', () => {
    it('defaults git config when no file exists', () => {
      mockNoConfigFile();
      const cfg = loadFerryConfig('/repo');
      expect(cfg.git).toEqual({
        base_branch: null,
        target_branch: null,
        working_branch_prefix: 'ferry/',
      });
    });

    it('defaults git config when git section is absent from file', () => {
      mockConfigFile('ferry.config.json', JSON.stringify({ limits: { max_iterations: 2 } }));
      const cfg = loadFerryConfig('/repo');
      expect(cfg.git).toEqual({
        base_branch: null,
        target_branch: null,
        working_branch_prefix: 'ferry/',
      });
    });

    it('parses explicit base_branch and target_branch', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ git: { base_branch: 'develop', target_branch: 'develop' } }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.git.base_branch).toBe('develop');
      expect(cfg.git.target_branch).toBe('develop');
      expect(cfg.git.working_branch_prefix).toBe('ferry/');
    });

    it('parses custom working_branch_prefix', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ git: { working_branch_prefix: 'bot/' } }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.git.working_branch_prefix).toBe('bot/');
    });

    it('allows null base_branch and null target_branch explicitly', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ git: { base_branch: null, target_branch: null } }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.git.base_branch).toBeNull();
      expect(cfg.git.target_branch).toBeNull();
    });

    it('allows target_branch: null with an explicit base_branch', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ git: { base_branch: 'next', target_branch: null } }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.git.base_branch).toBe('next');
      expect(cfg.git.target_branch).toBeNull();
    });

    it('throws on empty working_branch_prefix', () => {
      mockConfigFile('ferry.config.json', JSON.stringify({ git: { working_branch_prefix: '' } }));
      expect(() => loadFerryConfig('/repo')).toThrow(FerryError);
    });

    it('throws on non-string base_branch', () => {
      mockConfigFile('ferry.config.json', JSON.stringify({ git: { base_branch: 42 } }));
      let thrown: FerryError | null = null;
      try {
        loadFerryConfig('/repo');
      } catch (e) {
        thrown = e as FerryError;
      }
      expect(thrown).toBeInstanceOf(FerryError);
      const errors = thrown?.context?.errors as string[];
      expect(errors.some((e) => e.includes('git.base_branch'))).toBe(true);
    });

    it('throws on empty string base_branch', () => {
      mockConfigFile('ferry.config.json', JSON.stringify({ git: { base_branch: '' } }));
      expect(() => loadFerryConfig('/repo')).toThrow(FerryError);
    });
  });

  describe('labels section', () => {
    it('is undefined when not specified in config', () => {
      mockConfigFile('ferry.config.json', JSON.stringify({}));
      const cfg = loadFerryConfig('/repo');
      expect(cfg.labels).toBeUndefined();
    });

    it('is undefined when no config file exists', () => {
      mockNoConfigFile();
      const cfg = loadFerryConfig('/repo');
      expect(cfg.labels).toBeUndefined();
    });

    it('parses a labels section with mcp_servers', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({
          labels: {
            'ferry:mcp/context7': { mcp_servers: ['context7'] },
          },
        }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.labels).toBeDefined();
      expect(cfg.labels!['ferry:mcp/context7']).toEqual({ mcp_servers: ['context7'] });
    });

    it('parses a labels section with mcp_servers and tools', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({
          labels: {
            'ferry:mcp/sentry': { mcp_servers: ['sentry'], tools: ['fetch_runtime_logs'] },
          },
        }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.labels!['ferry:mcp/sentry']).toEqual({
        mcp_servers: ['sentry'],
        tools: ['fetch_runtime_logs'],
      });
    });

    it('parses a profile label that expands to multiple servers', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({
          labels: {
            'ferry:profile/frontend': { mcp_servers: ['context7', 'playwright'] },
          },
        }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.labels!['ferry:profile/frontend'].mcp_servers).toEqual(['context7', 'playwright']);
    });

    it('throws on invalid labels shape (not an object)', () => {
      mockConfigFile('ferry.config.json', JSON.stringify({ labels: 'bad' }));
      expect(() => loadFerryConfig('/repo')).toThrow(FerryError);
    });

    it('throws when a label entry has non-string-array mcp_servers', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ labels: { 'ferry:mcp/x': { mcp_servers: [1, 2] } } }),
      );
      expect(() => loadFerryConfig('/repo')).toThrow(FerryError);
    });

    it('throws when a label entry has non-string-array tools', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ labels: { 'ferry:mcp/x': { tools: 42 } } }),
      );
      expect(() => loadFerryConfig('/repo')).toThrow(FerryError);
    });
  });

  describe('workflow.agents section', () => {
    it('defaults include all workflow.agents settings', () => {
      mockNoConfigFile();
      const cfg = loadFerryConfig('/repo');
      expect(cfg.workflow.agents.refiner.trigger_column).toBe('Refinement');
      expect(cfg.workflow.agents.refiner.auto_transition).toBeNull();
      expect(cfg.workflow.agents.developer.trigger_column).toBe('In Development');
      expect(cfg.workflow.agents.developer.auto_transition).toBe('In Review');
      expect(cfg.workflow.agents.reviewer.trigger_column).toBe('In Review');
      expect(cfg.workflow.agents.reviewer.auto_transition_approve).toBeNull();
      expect(cfg.workflow.agents.reviewer.auto_transition_changes).toBe('Changes Requested');
      expect(cfg.workflow.agents.iterator.trigger_column).toBe('Changes Requested');
      expect(cfg.workflow.agents.iterator.auto_transition).toBe('In Review');
      expect(cfg.workflow.agents.merger.trigger_column).toBe('Ready to Merge');
      expect(cfg.workflow.agents.merger.auto_transition_done).toBeNull();
    });

    it('merges partial workflow.agents from config', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({
          workflow: {
            agents: {
              developer: { trigger_column: 'Dev Queue', auto_transition: null },
            },
          },
        }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.workflow.agents.developer.trigger_column).toBe('Dev Queue');
      expect(cfg.workflow.agents.developer.auto_transition).toBeNull();
      // Non-configured agents keep defaults
      expect(cfg.workflow.agents.reviewer.trigger_column).toBe('In Review');
      expect(cfg.workflow.agents.reviewer.auto_transition_changes).toBe('Changes Requested');
      expect(cfg.workflow.agents.merger.auto_transition_done).toBeNull();
    });

    it('allows overriding the merger trigger_column', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ workflow: { agents: { merger: { trigger_column: 'Prêt à merger' } } } }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.workflow.agents.merger.trigger_column).toBe('Prêt à merger');
      expect(cfg.workflow.agents.merger.auto_transition_done).toBeNull();
    });

    it('throws on invalid merger trigger_column type', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ workflow: { agents: { merger: { trigger_column: 42 } } } }),
      );
      let thrown: FerryError | null = null;
      try {
        loadFerryConfig('/repo');
      } catch (e) {
        thrown = e as FerryError;
      }
      expect(thrown).toBeInstanceOf(FerryError);
      const errors = thrown?.context?.errors as string[];
      expect(errors.some((e) => e.includes('workflow.agents.merger.trigger_column'))).toBe(true);
    });

    it('allows setting auto_transition_done for merger', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ workflow: { agents: { merger: { auto_transition_done: 'Done' } } } }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.workflow.agents.merger.auto_transition_done).toBe('Done');
    });

    it('allows null auto_transition_done for merger', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ workflow: { agents: { merger: { auto_transition_done: null } } } }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.workflow.agents.merger.auto_transition_done).toBeNull();
    });

    it('throws on invalid auto_transition_done type', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ workflow: { agents: { merger: { auto_transition_done: 42 } } } }),
      );
      let thrown: FerryError | null = null;
      try {
        loadFerryConfig('/repo');
      } catch (e) {
        thrown = e as FerryError;
      }
      expect(thrown).toBeInstanceOf(FerryError);
      const errors = thrown?.context?.errors as string[];
      expect(errors.some((e) => e.includes('workflow.agents.merger.auto_transition_done'))).toBe(
        true,
      );
    });

    it('allows null auto_transition for developer', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ workflow: { agents: { developer: { auto_transition: null } } } }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.workflow.agents.developer.auto_transition).toBeNull();
    });

    it('allows null auto_transition_changes for reviewer', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({
          workflow: { agents: { reviewer: { auto_transition_changes: null } } },
        }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.workflow.agents.reviewer.auto_transition_changes).toBeNull();
    });

    it('allows setting auto_transition_approve for reviewer', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({
          workflow: { agents: { reviewer: { auto_transition_approve: 'Ready to Merge' } } },
        }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.workflow.agents.reviewer.auto_transition_approve).toBe('Ready to Merge');
    });

    it('throws on invalid auto_transition type', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({
          workflow: { agents: { developer: { auto_transition: 42 } } },
        }),
      );
      let thrown: FerryError | null = null;
      try {
        loadFerryConfig('/repo');
      } catch (e) {
        thrown = e as FerryError;
      }
      expect(thrown).toBeInstanceOf(FerryError);
      const errors = thrown?.context?.errors as string[];
      expect(errors.some((e) => e.includes('workflow.agents.developer.auto_transition'))).toBe(
        true,
      );
    });

    it('throws on invalid trigger_column type', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({
          workflow: { agents: { refiner: { trigger_column: 123 } } },
        }),
      );
      let thrown: FerryError | null = null;
      try {
        loadFerryConfig('/repo');
      } catch (e) {
        thrown = e as FerryError;
      }
      expect(thrown).toBeInstanceOf(FerryError);
      const errors = thrown?.context?.errors as string[];
      expect(errors.some((e) => e.includes('workflow.agents.refiner.trigger_column'))).toBe(true);
    });

    it('supports custom column names for all agents', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({
          workflow: {
            agents: {
              refiner: { trigger_column: 'Ready for Refinement' },
              developer: { trigger_column: 'In Progress', auto_transition: 'Code Review' },
              reviewer: {
                trigger_column: 'Code Review',
                auto_transition_approve: 'Ready to Deploy',
                auto_transition_changes: 'Needs Work',
              },
              iterator: { trigger_column: 'Needs Work', auto_transition: 'Code Review' },
              merger: { auto_transition_done: 'Deployed' },
            },
          },
        }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.workflow.agents.refiner.trigger_column).toBe('Ready for Refinement');
      expect(cfg.workflow.agents.developer.trigger_column).toBe('In Progress');
      expect(cfg.workflow.agents.developer.auto_transition).toBe('Code Review');
      expect(cfg.workflow.agents.reviewer.auto_transition_approve).toBe('Ready to Deploy');
      expect(cfg.workflow.agents.reviewer.auto_transition_changes).toBe('Needs Work');
      expect(cfg.workflow.agents.iterator.auto_transition).toBe('Code Review');
      expect(cfg.workflow.agents.merger.auto_transition_done).toBe('Deployed');
    });
  });

  describe('git section', () => {
    it('defaults git config when no file exists', () => {
      mockNoConfigFile();
      const cfg = loadFerryConfig('/repo');
      expect(cfg.git).toEqual({
        base_branch: null,
        target_branch: null,
        working_branch_prefix: 'ferry/',
      });
    });

    it('defaults git config when git section is absent from file', () => {
      mockConfigFile('ferry.config.json', JSON.stringify({ limits: { max_iterations: 2 } }));
      const cfg = loadFerryConfig('/repo');
      expect(cfg.git).toEqual({
        base_branch: null,
        target_branch: null,
        working_branch_prefix: 'ferry/',
      });
    });

    it('parses explicit base_branch and target_branch', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ git: { base_branch: 'develop', target_branch: 'develop' } }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.git.base_branch).toBe('develop');
      expect(cfg.git.target_branch).toBe('develop');
      expect(cfg.git.working_branch_prefix).toBe('ferry/');
    });

    it('parses custom working_branch_prefix', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ git: { working_branch_prefix: 'bot/' } }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.git.working_branch_prefix).toBe('bot/');
    });

    it('allows null base_branch and null target_branch explicitly', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ git: { base_branch: null, target_branch: null } }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.git.base_branch).toBeNull();
      expect(cfg.git.target_branch).toBeNull();
    });

    it('allows target_branch: null with an explicit base_branch', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ git: { base_branch: 'next', target_branch: null } }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.git.base_branch).toBe('next');
      expect(cfg.git.target_branch).toBeNull();
    });

    it('throws on empty working_branch_prefix', () => {
      mockConfigFile('ferry.config.json', JSON.stringify({ git: { working_branch_prefix: '' } }));
      expect(() => loadFerryConfig('/repo')).toThrow(FerryError);
    });

    it('accepts a mapping working_branch_prefix with a default key', () => {
      const mapping = { Bug: 'bugfix/', Story: 'feature/', default: 'ferry/' };
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ git: { working_branch_prefix: mapping } }),
      );
      const cfg = loadFerryConfig('/repo');
      expect(cfg.git.working_branch_prefix).toEqual(mapping);
    });

    it('throws when mapping working_branch_prefix has no default key', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ git: { working_branch_prefix: { Bug: 'bugfix/', Story: 'feature/' } } }),
      );
      let thrown: FerryError | null = null;
      try {
        loadFerryConfig('/repo');
      } catch (e) {
        thrown = e as FerryError;
      }
      expect(thrown).toBeInstanceOf(FerryError);
      const errors = thrown?.context?.errors as string[];
      expect(errors.some((e) => e.includes('default'))).toBe(true);
    });

    it('throws when a mapping value is an empty string', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ git: { working_branch_prefix: { Bug: '', default: 'ferry/' } } }),
      );
      let thrown: FerryError | null = null;
      try {
        loadFerryConfig('/repo');
      } catch (e) {
        thrown = e as FerryError;
      }
      expect(thrown).toBeInstanceOf(FerryError);
      const errors = thrown?.context?.errors as string[];
      expect(errors.some((e) => e.includes('git.working_branch_prefix.Bug'))).toBe(true);
    });

    it('throws when a mapping value is not a string', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ git: { working_branch_prefix: { Bug: 42, default: 'ferry/' } } }),
      );
      expect(() => loadFerryConfig('/repo')).toThrow(FerryError);
    });

    it('throws when working_branch_prefix is an invalid type (array)', () => {
      mockConfigFile(
        'ferry.config.json',
        JSON.stringify({ git: { working_branch_prefix: ['bugfix/'] } }),
      );
      expect(() => loadFerryConfig('/repo')).toThrow(FerryError);
    });

    it('throws on non-string base_branch', () => {
      mockConfigFile('ferry.config.json', JSON.stringify({ git: { base_branch: 42 } }));
      let thrown: FerryError | null = null;
      try {
        loadFerryConfig('/repo');
      } catch (e) {
        thrown = e as FerryError;
      }
      expect(thrown).toBeInstanceOf(FerryError);
      const errors = thrown?.context?.errors as string[];
      expect(errors.some((e) => e.includes('git.base_branch'))).toBe(true);
    });

    it('throws on empty string base_branch', () => {
      mockConfigFile('ferry.config.json', JSON.stringify({ git: { base_branch: '' } }));
      expect(() => loadFerryConfig('/repo')).toThrow(FerryError);
    });
  });
});

describe('parseFerryConfigJson', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('parses a valid JSON string and returns merged config', () => {
    const cfg = parseFerryConfigJson(JSON.stringify({ limits: { max_tokens_per_run: 5_000_000 } }));
    expect(cfg.limits.max_tokens_per_run).toBe(5_000_000);
    expect(cfg.limits.max_iterations).toBe(DEFAULT_FERRY_CONFIG.limits.max_iterations);
  });

  it('parses an empty object and returns defaults', () => {
    const cfg = parseFerryConfigJson('{}');
    expect(cfg).toEqual(DEFAULT_FERRY_CONFIG);
  });

  it('throws FerryError on invalid JSON syntax', () => {
    expect(() => parseFerryConfigJson('{ bad json }')).toThrow(FerryError);
  });

  it('throws FerryError on invalid config shape', () => {
    expect(() =>
      parseFerryConfigJson(
        JSON.stringify({ models: { dev: { provider: 'unknown-provider', model: 'x' } } }),
      ),
    ).toThrow(FerryError);
  });

  it('applies env var overrides on top of the parsed config', () => {
    vi.stubEnv('FERRY_DEV_MODEL', 'claude-haiku-4-5-20251001');
    const cfg = parseFerryConfigJson(JSON.stringify({}));
    expect(cfg.models.dev.model).toBe('claude-haiku-4-5-20251001');
  });
});

describe('execution_path + routing config (ADR-0006, #300)', () => {
  it('defaults: execution_path is unset (conditional default) and routing threshold is 2', () => {
    const cfg = parseFerryConfigJson('{}');
    expect(cfg.execution_path).toBeUndefined();
    expect(cfg.routing.claude_code_round_trip_threshold).toBe(2);
  });

  it('DEFAULT_FERRY_CONFIG carries the routing default and no execution_path', () => {
    expect(DEFAULT_FERRY_CONFIG.execution_path).toBeUndefined();
    expect(DEFAULT_FERRY_CONFIG.routing.claude_code_round_trip_threshold).toBe(2);
  });

  it('parses execution_path "script"', () => {
    const cfg = parseFerryConfigJson(JSON.stringify({ execution_path: 'script' }));
    expect(cfg.execution_path).toBe('script');
  });

  it('parses execution_path "claude-code"', () => {
    const cfg = parseFerryConfigJson(JSON.stringify({ execution_path: 'claude-code' }));
    expect(cfg.execution_path).toBe('claude-code');
  });

  it('parses execution_path "codex-cli"', () => {
    const cfg = parseFerryConfigJson(JSON.stringify({ execution_path: 'codex-cli' }));
    expect(cfg.execution_path).toBe('codex-cli');
  });

  it('parses a custom routing threshold', () => {
    const cfg = parseFerryConfigJson(
      JSON.stringify({ routing: { claude_code_round_trip_threshold: 5 } }),
    );
    expect(cfg.routing.claude_code_round_trip_threshold).toBe(5);
  });

  it('rejects an unknown execution_path value', () => {
    expect(() => parseFerryConfigJson(JSON.stringify({ execution_path: 'agent-sdk' }))).toThrow(
      FerryError,
    );
  });

  it('rejects a non-positive routing threshold', () => {
    expect(() =>
      parseFerryConfigJson(JSON.stringify({ routing: { claude_code_round_trip_threshold: 0 } })),
    ).toThrow(FerryError);
  });

  it('rejects a non-object routing', () => {
    expect(() => parseFerryConfigJson(JSON.stringify({ routing: 'fast' }))).toThrow(FerryError);
  });
});

// FER-4/FER-37: FER is a Jira team-managed project whose only issue types are
// Tâche, Epic, and Sous-tâche — Ferry's default ticket_types allowlist
// (["Story", "Bug", "Spike"]) matches none of them, which would silently skip
// every dispatch on this repo. Locks in that the root config overrides the
// allowlist, and that the ticket-type skip path Ferry actually enforces at
// runtime (shouldSkipForTaskType, keyed off the literal "Task" issue type)
// does not treat a FER "Tâche" ticket as skippable.
describe('FER repo root ferry.config.json — Tâche allowlist (FER-4)', () => {
  it('refine_allowlist and dev_allowlist both include "Tâche"', async () => {
    const { readFileSync: actualReadFileSync } =
      await vi.importActual<typeof import('node:fs')>('node:fs');
    const rootConfigPath = fileURLToPath(new URL('../../ferry.config.json', import.meta.url));
    const content = actualReadFileSync(rootConfigPath, 'utf8');

    const cfg = parseFerryConfigJson(content);

    expect(cfg.ticket_types.refine_allowlist).toContain('Tâche');
    expect(cfg.ticket_types.dev_allowlist).toContain('Tâche');
  });

  it('a "Tâche" ticket is not skipped by the runtime ticket-type filter', () => {
    expect(shouldSkipForTaskType('Tâche')).toEqual({ skip: false });
  });
});
