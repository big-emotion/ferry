import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  resolveTicketOverrides,
  applyTicketOverrides,
  hasNonDefaultOverrides,
  buildOverridesAuditComment,
  buildConflictComment,
  LabelConflictError,
} from './overrides.js';
import { createTestLogger } from '../logger/index.js';
import type { FerryConfig } from '../config.js';
import { DEFAULT_FERRY_CONFIG } from '../config.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// ------------------------------------------------------------------
// resolveTicketOverrides
// ------------------------------------------------------------------

describe('resolveTicketOverrides — defaults', () => {
  it('returns safe defaults for empty label list', () => {
    const result = resolveTicketOverrides([]);
    expect(result.bypassTaskSkip).toBe(false);
    expect(result.typeOverride).toBeUndefined();
    expect(result.modelOverrides).toBeUndefined();
    expect(result.budget).toBeUndefined();
    expect(result.skipPhases).toBeUndefined();
    expect(result.thinking).toBeUndefined();
    expect(result.git).toBeUndefined();
    expect(result.paused).toBeUndefined();
  });

  it('returns safe defaults for non-ferry labels', () => {
    const result = resolveTicketOverrides(['bug', 'priority:high', 'frontend']);
    expect(result.bypassTaskSkip).toBe(false);
    expect(result.modelOverrides).toBeUndefined();
  });
});

// ------------------------------------------------------------------
// ferry:type:* (ticket-type overrides — delegates to resolveTypeOverrides)
// ------------------------------------------------------------------

describe('resolveTicketOverrides — ticket-type (ferry:type:*)', () => {
  it('sets bypassTaskSkip from ferry:type:enable-task', () => {
    expect(resolveTicketOverrides(['ferry:type:enable-task']).bypassTaskSkip).toBe(true);
  });

  it('sets typeOverride and forceLabel from ferry:type:force-bug', () => {
    const r = resolveTicketOverrides(['ferry:type:force-bug']);
    expect(r.typeOverride).toBe('Bug');
    expect(r.forceLabel).toBe('ferry:type:force-bug');
  });

  it('sets typeOverride to Spike for ferry:type:force-spike', () => {
    expect(resolveTicketOverrides(['ferry:type:force-spike']).typeOverride).toBe('Spike');
  });

  it('sets typeOverride to Story for ferry:type:force-story', () => {
    expect(resolveTicketOverrides(['ferry:type:force-story']).typeOverride).toBe('Story');
  });
});

// ------------------------------------------------------------------
// ferry:model/<phase>/<model-id>
// ------------------------------------------------------------------

describe('resolveTicketOverrides — model overrides (ferry:model/*)', () => {
  it('resolves a model override for the dev phase', () => {
    const r = resolveTicketOverrides(['ferry:model/dev/claude-opus-4-7']);
    expect(r.modelOverrides?.dev?.model).toBe('claude-opus-4-7');
  });

  it('resolves model overrides for multiple phases', () => {
    const r = resolveTicketOverrides([
      'ferry:model/dev/my-model',
      'ferry:model/review/other-model',
    ]);
    expect(r.modelOverrides?.dev?.model).toBe('my-model');
    expect(r.modelOverrides?.review?.model).toBe('other-model');
    expect(r.modelOverrides?.refiner).toBeUndefined();
  });

  it('handles model IDs that contain slashes (org/model format)', () => {
    const r = resolveTicketOverrides(['ferry:model/dev/openai/gpt-4o']);
    expect(r.modelOverrides?.dev?.model).toBe('openai/gpt-4o');
  });

  it('throws LabelConflictError when two labels override the same phase model', () => {
    expect(() =>
      resolveTicketOverrides([
        'ferry:model/dev/claude-opus-4-7',
        'ferry:model/dev/claude-sonnet-4-6',
      ]),
    ).toThrow(LabelConflictError);
  });

  it('includes conflicting label names and field in LabelConflictError', () => {
    let err: LabelConflictError | undefined;
    try {
      resolveTicketOverrides([
        'ferry:model/dev/claude-opus-4-7',
        'ferry:model/dev/claude-sonnet-4-6',
      ]);
    } catch (e) {
      err = e as LabelConflictError;
    }
    expect(err).toBeInstanceOf(LabelConflictError);
    expect(err?.label1).toBe('ferry:model/dev/claude-opus-4-7');
    expect(err?.label2).toBe('ferry:model/dev/claude-sonnet-4-6');
    expect(err?.field).toBe('model.dev');
  });

  it('logs a warning and ignores malformed ferry:model label (no phase)', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:model/notamodel'], logger);
    expect(r.modelOverrides).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn')).toBe(true);
  });

  it('logs a warning and ignores unknown phase in ferry:model label', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:model/badphase/some-model'], logger);
    expect(r.modelOverrides).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn')).toBe(true);
  });
});

// ------------------------------------------------------------------
// ferry:provider/<phase>/<provider>
// ------------------------------------------------------------------

describe('resolveTicketOverrides — provider overrides (ferry:provider/*)', () => {
  it('resolves a provider override for the dev phase', () => {
    const r = resolveTicketOverrides(['ferry:provider/dev/openai']);
    expect(r.modelOverrides?.dev?.provider).toBe('openai');
  });

  it('resolves provider overrides for multiple phases', () => {
    const r = resolveTicketOverrides(['ferry:provider/dev/openai', 'ferry:provider/review/google']);
    expect(r.modelOverrides?.dev?.provider).toBe('openai');
    expect(r.modelOverrides?.review?.provider).toBe('google');
  });

  it('throws LabelConflictError when two labels override the same phase provider', () => {
    expect(() =>
      resolveTicketOverrides(['ferry:provider/dev/anthropic', 'ferry:provider/dev/openai']),
    ).toThrow(LabelConflictError);
  });

  it('model and provider for the same phase are merged (not a conflict)', () => {
    const r = resolveTicketOverrides([
      'ferry:model/dev/claude-opus-4-7',
      'ferry:provider/dev/anthropic',
    ]);
    expect(r.modelOverrides?.dev?.model).toBe('claude-opus-4-7');
    expect(r.modelOverrides?.dev?.provider).toBe('anthropic');
  });

  it('logs a warning and ignores unknown provider', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:provider/dev/notaprovider'], logger);
    expect(r.modelOverrides).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn')).toBe(true);
  });
});

// ------------------------------------------------------------------
// ferry:budget/*
// ------------------------------------------------------------------

describe('resolveTicketOverrides — budget overrides (ferry:budget/*)', () => {
  it('resolves max-cost override', () => {
    const r = resolveTicketOverrides(['ferry:budget/max-cost/5']);
    expect(r.budget?.maxCostEurPerRun).toBe(5);
  });

  it('resolves max-cost with decimal value', () => {
    const r = resolveTicketOverrides(['ferry:budget/max-cost/2.5']);
    expect(r.budget?.maxCostEurPerRun).toBe(2.5);
  });

  it('resolves max-tokens override', () => {
    const r = resolveTicketOverrides(['ferry:budget/max-tokens/200000']);
    expect(r.budget?.maxTokensPerRun).toBe(200000);
  });

  it('resolves both budget fields together', () => {
    const r = resolveTicketOverrides(['ferry:budget/max-cost/3', 'ferry:budget/max-tokens/100000']);
    expect(r.budget?.maxCostEurPerRun).toBe(3);
    expect(r.budget?.maxTokensPerRun).toBe(100000);
  });

  it('throws LabelConflictError on duplicate max-cost labels', () => {
    expect(() =>
      resolveTicketOverrides(['ferry:budget/max-cost/5', 'ferry:budget/max-cost/10']),
    ).toThrow(LabelConflictError);
  });

  it('throws LabelConflictError on duplicate max-tokens labels', () => {
    expect(() =>
      resolveTicketOverrides(['ferry:budget/max-tokens/100000', 'ferry:budget/max-tokens/200000']),
    ).toThrow(LabelConflictError);
  });

  it('logs a warning and ignores non-numeric max-cost value', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:budget/max-cost/notanumber'], logger);
    expect(r.budget).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn')).toBe(true);
  });

  it('logs a warning and ignores zero or negative max-cost', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:budget/max-cost/0'], logger);
    expect(r.budget).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn')).toBe(true);
  });
});

// ------------------------------------------------------------------
// ferry:skip/<phase>
// ------------------------------------------------------------------

describe('resolveTicketOverrides — phase skips (ferry:skip/*)', () => {
  it('adds a phase to skipPhases', () => {
    const r = resolveTicketOverrides(['ferry:skip/review']);
    expect(r.skipPhases).toEqual(['review']);
  });

  it('accumulates multiple skip phases without conflict', () => {
    const r = resolveTicketOverrides(['ferry:skip/review', 'ferry:skip/iterate']);
    expect(r.skipPhases).toContain('review');
    expect(r.skipPhases).toContain('iterate');
  });

  it('deduplicates repeated skip labels for the same phase', () => {
    const r = resolveTicketOverrides(['ferry:skip/dev', 'ferry:skip/dev']);
    expect(r.skipPhases?.filter((p) => p === 'dev')).toHaveLength(1);
  });

  it('logs a warning and ignores unknown phase in ferry:skip label', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:skip/badphase'], logger);
    expect(r.skipPhases).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn')).toBe(true);
  });
});

// ------------------------------------------------------------------
// ferry:thinking/*
// ------------------------------------------------------------------

describe('resolveTicketOverrides — thinking mode (ferry:thinking/*)', () => {
  it('sets thinking to "on"', () => {
    expect(resolveTicketOverrides(['ferry:thinking/on']).thinking).toBe('on');
  });

  it('sets thinking to "off"', () => {
    expect(resolveTicketOverrides(['ferry:thinking/off']).thinking).toBe('off');
  });

  it('throws LabelConflictError when ferry:thinking/on and ferry:thinking/off both present', () => {
    expect(() => resolveTicketOverrides(['ferry:thinking/on', 'ferry:thinking/off'])).toThrow(
      LabelConflictError,
    );
  });

  it('does not throw when the same thinking label appears twice', () => {
    expect(() => resolveTicketOverrides(['ferry:thinking/on', 'ferry:thinking/on'])).not.toThrow();
    expect(resolveTicketOverrides(['ferry:thinking/on', 'ferry:thinking/on']).thinking).toBe('on');
  });
});

// ------------------------------------------------------------------
// ferry:git/*
// ------------------------------------------------------------------

describe('resolveTicketOverrides — git overrides (ferry:git/*)', () => {
  it('sets git.noPr to true for ferry:git/no-pr', () => {
    const r = resolveTicketOverrides(['ferry:git/no-pr']);
    expect(r.git?.noPr).toBe(true);
  });

  it('git.noPr is not set when label is absent', () => {
    expect(resolveTicketOverrides([]).git).toBeUndefined();
  });
});

// ------------------------------------------------------------------
// ferry:paused (safety)
// ------------------------------------------------------------------

describe('resolveTicketOverrides — safety labels', () => {
  it('sets paused to true for ferry:paused', () => {
    expect(resolveTicketOverrides(['ferry:paused']).paused).toBe(true);
  });

  it('paused is not set when label is absent', () => {
    expect(resolveTicketOverrides([]).paused).toBeUndefined();
  });

  it('does not warn about ferry:spend-cap (recognised safety label)', () => {
    const { logger, records } = createTestLogger('t', 'test');
    resolveTicketOverrides(['ferry:spend-cap'], logger);
    expect(records.filter((r) => r.level === 'warn')).toHaveLength(0);
  });
});

// ------------------------------------------------------------------
// Unknown labels
// ------------------------------------------------------------------

describe('resolveTicketOverrides — unknown labels', () => {
  it('logs and ignores unrecognised ferry: override labels', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:unknown-namespace/foo'], logger);
    expect(r.modelOverrides).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn')).toBe(true);
  });

  it('silently passes ferry:mcp/* labels (handled by resolveCapabilities)', () => {
    const { logger, records } = createTestLogger('t', 'test');
    resolveTicketOverrides(['ferry:mcp/context7'], logger);
    expect(records.filter((r) => r.level === 'warn')).toHaveLength(0);
  });

  it('silently passes ferry:profile/* labels (handled by resolveCapabilities)', () => {
    const { logger, records } = createTestLogger('t', 'test');
    resolveTicketOverrides(['ferry:profile/frontend'], logger);
    expect(records.filter((r) => r.level === 'warn')).toHaveLength(0);
  });

  it('silently passes ferry:refining status label', () => {
    const { logger, records } = createTestLogger('t', 'test');
    resolveTicketOverrides(['ferry:refining'], logger);
    expect(records.filter((r) => r.level === 'warn')).toHaveLength(0);
  });

  it('does not warn about non-ferry labels', () => {
    const { logger, records } = createTestLogger('t', 'test');
    resolveTicketOverrides(['bug', 'priority:high'], logger);
    expect(records).toHaveLength(0);
  });
});

// ------------------------------------------------------------------
// Mixed labels
// ------------------------------------------------------------------

describe('resolveTicketOverrides — mixed label sets', () => {
  it('combines type overrides + model overrides + budget', () => {
    const r = resolveTicketOverrides([
      'ferry:type:enable-task',
      'ferry:model/dev/claude-opus-4-7',
      'ferry:budget/max-cost/5',
    ]);
    expect(r.bypassTaskSkip).toBe(true);
    expect(r.modelOverrides?.dev?.model).toBe('claude-opus-4-7');
    expect(r.budget?.maxCostEurPerRun).toBe(5);
  });

  it('combines model + provider + skip + thinking', () => {
    const r = resolveTicketOverrides([
      'ferry:model/dev/claude-opus-4-7',
      'ferry:provider/dev/anthropic',
      'ferry:skip/review',
      'ferry:thinking/on',
    ]);
    expect(r.modelOverrides?.dev?.model).toBe('claude-opus-4-7');
    expect(r.modelOverrides?.dev?.provider).toBe('anthropic');
    expect(r.skipPhases).toContain('review');
    expect(r.thinking).toBe('on');
  });
});

// ------------------------------------------------------------------
// applyTicketOverrides
// ------------------------------------------------------------------

const BASE_CFG: FerryConfig = DEFAULT_FERRY_CONFIG;

describe('applyTicketOverrides', () => {
  it('returns same config reference when no model or budget overrides present', () => {
    const overrides = resolveTicketOverrides([]);
    expect(applyTicketOverrides(BASE_CFG, overrides)).toBe(BASE_CFG);
  });

  it('applies model override for dev phase', () => {
    const overrides = resolveTicketOverrides(['ferry:model/dev/my-model']);
    const cfg = applyTicketOverrides(BASE_CFG, overrides);
    expect(cfg.models.dev.model).toBe('my-model');
    expect(cfg.models.dev.provider).toBe(BASE_CFG.models.dev.provider);
  });

  it('applies provider override for review phase', () => {
    const overrides = resolveTicketOverrides(['ferry:provider/review/openai']);
    const cfg = applyTicketOverrides(BASE_CFG, overrides);
    expect(cfg.models.review.provider).toBe('openai');
    expect(cfg.models.review.model).toBe(BASE_CFG.models.review.model);
  });

  it('applies model + provider override together for the same phase', () => {
    const overrides = resolveTicketOverrides([
      'ferry:model/iterate/gpt-4o',
      'ferry:provider/iterate/openai',
    ]);
    const cfg = applyTicketOverrides(BASE_CFG, overrides);
    expect(cfg.models.iterate.model).toBe('gpt-4o');
    expect(cfg.models.iterate.provider).toBe('openai');
  });

  it('applies budget max-cost override to limits', () => {
    const overrides = resolveTicketOverrides(['ferry:budget/max-cost/3.5']);
    const cfg = applyTicketOverrides(BASE_CFG, overrides);
    expect(cfg.limits.max_cost_eur_per_run).toBe(3.5);
  });

  it('applies budget max-tokens override to limits', () => {
    const overrides = resolveTicketOverrides(['ferry:budget/max-tokens/150000']);
    const cfg = applyTicketOverrides(BASE_CFG, overrides);
    expect(cfg.limits.max_tokens_per_run).toBe(150000);
  });

  it('does not modify the original config object (immutable)', () => {
    const overrides = resolveTicketOverrides(['ferry:model/dev/modified-model']);
    applyTicketOverrides(BASE_CFG, overrides);
    expect(BASE_CFG.models.dev.model).not.toBe('modified-model');
  });

  it('does not modify other phases when only one phase has an override', () => {
    const overrides = resolveTicketOverrides(['ferry:model/dev/new-model']);
    const cfg = applyTicketOverrides(BASE_CFG, overrides);
    expect(cfg.models.refiner).toEqual(BASE_CFG.models.refiner);
    expect(cfg.models.review).toEqual(BASE_CFG.models.review);
    expect(cfg.models.iterate).toEqual(BASE_CFG.models.iterate);
  });

  it('applies overrides for all four phases', () => {
    const overrides = resolveTicketOverrides([
      'ferry:model/refiner/refiner-model',
      'ferry:model/dev/dev-model',
      'ferry:model/review/review-model',
      'ferry:model/iterate/iter-model',
    ]);
    const cfg = applyTicketOverrides(BASE_CFG, overrides);
    expect(cfg.models.refiner.model).toBe('refiner-model');
    expect(cfg.models.dev.model).toBe('dev-model');
    expect(cfg.models.review.model).toBe('review-model');
    expect(cfg.models.iterate.model).toBe('iter-model');
  });
});

// ------------------------------------------------------------------
// hasNonDefaultOverrides
// ------------------------------------------------------------------

describe('hasNonDefaultOverrides', () => {
  it('returns false for default overrides', () => {
    expect(hasNonDefaultOverrides(resolveTicketOverrides([]))).toBe(false);
  });

  it('returns true when bypassTaskSkip is set', () => {
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:type:enable-task']))).toBe(true);
  });

  it('returns true when typeOverride is set', () => {
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:type:force-bug']))).toBe(true);
  });

  it('returns true when modelOverrides is present', () => {
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:model/dev/some-model']))).toBe(
      true,
    );
  });

  it('returns true when budget is present', () => {
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:budget/max-cost/5']))).toBe(true);
  });

  it('returns true when skipPhases is non-empty', () => {
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:skip/review']))).toBe(true);
  });

  it('returns true when thinking is set', () => {
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:thinking/on']))).toBe(true);
  });

  it('returns true when git.noPr is set', () => {
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:git/no-pr']))).toBe(true);
  });

  it('returns true when paused is set', () => {
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:paused']))).toBe(true);
  });
});

// ------------------------------------------------------------------
// buildOverridesAuditComment
// ------------------------------------------------------------------

describe('buildOverridesAuditComment', () => {
  it('follows fingerprint format [ferry:<role>:<run-id>]', () => {
    const overrides = resolveTicketOverrides(['ferry:model/dev/some-model']);
    const comment = buildOverridesAuditComment('developer', 'abc123', overrides);
    expect(comment).toMatch(/^\[ferry:developer:abc123\]/);
  });

  it('includes JSON-serialized overrides', () => {
    const overrides = resolveTicketOverrides(['ferry:model/dev/claude-opus-4-7']);
    const comment = buildOverridesAuditComment('developer', 'run1', overrides);
    expect(comment).toContain('"modelOverrides"');
    expect(comment).toContain('"claude-opus-4-7"');
  });

  it('includes the "overrides applied:" prefix', () => {
    const overrides = resolveTicketOverrides(['ferry:budget/max-cost/5']);
    const comment = buildOverridesAuditComment('refiner', 'r1', overrides);
    expect(comment).toContain('overrides applied:');
  });
});

// ------------------------------------------------------------------
// buildConflictComment
// ------------------------------------------------------------------

describe('buildConflictComment', () => {
  it('follows fingerprint format and includes conflict details', () => {
    const err = new LabelConflictError(
      'ferry:model/dev/opus',
      'ferry:model/dev/sonnet',
      'model.dev',
    );
    const comment = buildConflictComment('developer', 'run1', err);
    expect(comment).toMatch(/^\[ferry:developer:run1\]/);
    expect(comment).toContain('ferry:model/dev/opus');
    expect(comment).toContain('ferry:model/dev/sonnet');
    expect(comment).toContain('model.dev');
  });
});
