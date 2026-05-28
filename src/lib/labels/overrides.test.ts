import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  resolveTicketOverrides,
  applyTicketOverrides,
  hasNonDefaultOverrides,
  buildOverridesAuditComment,
  buildConflictComment,
  applyDryRunMarker,
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
// ferry:as/<type> (alias namespace from issue #242)
// ------------------------------------------------------------------

describe('resolveTicketOverrides — ferry:as/<type> alias namespace (#242)', () => {
  it('sets typeOverride to Spike for ferry:as/spike', () => {
    const r = resolveTicketOverrides(['ferry:as/spike']);
    expect(r.typeOverride).toBe('Spike');
    expect(r.forceLabel).toBe('ferry:as/spike');
  });

  it('sets typeOverride to Bug for ferry:as/bug', () => {
    const r = resolveTicketOverrides(['ferry:as/bug']);
    expect(r.typeOverride).toBe('Bug');
    expect(r.forceLabel).toBe('ferry:as/bug');
  });

  it('sets typeOverride to Story for ferry:as/story', () => {
    const r = resolveTicketOverrides(['ferry:as/story']);
    expect(r.typeOverride).toBe('Story');
    expect(r.forceLabel).toBe('ferry:as/story');
  });

  it('does NOT set bypassTaskSkip — Task-skip is preserved (FR6 structural rule)', () => {
    const r = resolveTicketOverrides(['ferry:as/story']);
    expect(r.bypassTaskSkip).toBe(false);
  });

  it('throws LabelConflictError when two different ferry:as/<x> labels are present', () => {
    expect(() => resolveTicketOverrides(['ferry:as/bug', 'ferry:as/story'])).toThrow(
      LabelConflictError,
    );
  });

  it('is vacuous (no conflict) when the same ferry:as/<x> label is repeated', () => {
    const r = resolveTicketOverrides(['ferry:as/bug', 'ferry:as/bug']);
    expect(r.typeOverride).toBe('Bug');
  });

  it('throws LabelConflictError when ferry:as/<a> and ferry:type:force-<b> map to different values', () => {
    expect(() => resolveTicketOverrides(['ferry:as/bug', 'ferry:type:force-story'])).toThrow(
      LabelConflictError,
    );
  });

  it('emits typeOverride field name on cross-namespace conflict', () => {
    try {
      resolveTicketOverrides(['ferry:as/bug', 'ferry:type:force-story']);
      throw new Error('expected LabelConflictError');
    } catch (err) {
      expect(err).toBeInstanceOf(LabelConflictError);
      expect((err as LabelConflictError).field).toBe('typeOverride');
    }
  });

  it('does NOT conflict when ferry:as/<x> and ferry:type:force-<x> map to the same value', () => {
    const r = resolveTicketOverrides(['ferry:as/bug', 'ferry:type:force-bug']);
    expect(r.typeOverride).toBe('Bug');
  });

  it('logs a warning and ignores ferry:as/<unknown> suffix', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:as/improvement'], logger);
    expect(r.typeOverride).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn' && rec.message.includes('ferry:as'))).toBe(
      true,
    );
  });

  it('still allows ferry:type:enable-task to coexist with ferry:as/<x> (different fields)', () => {
    const r = resolveTicketOverrides(['ferry:type:enable-task', 'ferry:as/story']);
    expect(r.bypassTaskSkip).toBe(true);
    expect(r.typeOverride).toBe('Story');
  });

  it('surfaces ferry:as/<x> typeOverride in the audit comment payload', () => {
    const overrides = resolveTicketOverrides(['ferry:as/spike']);
    const body = buildOverridesAuditComment('developer', 'r1', overrides);
    expect(body).toContain('"typeOverride":"Spike"');
  });

  it('does NOT emit ferry:as/<x> as an unknown label warning', () => {
    const { logger, records } = createTestLogger('t', 'test');
    resolveTicketOverrides(['ferry:as/bug'], logger);
    expect(records.filter((r) => r.level === 'warn')).toHaveLength(0);
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

  it('treats ferry:model/<name> (no slash) as a blanket model override for all phases', () => {
    const r = resolveTicketOverrides(['ferry:model/claude-opus-4-7']);
    expect(r.modelOverrides?.refiner?.model).toBe('claude-opus-4-7');
    expect(r.modelOverrides?.dev?.model).toBe('claude-opus-4-7');
    expect(r.modelOverrides?.review?.model).toBe('claude-opus-4-7');
    expect(r.modelOverrides?.iterate?.model).toBe('claude-opus-4-7');
  });

  it('treats ferry:model/<non-phase>/<rest> as blanket model with full rest as name', () => {
    const r = resolveTicketOverrides(['ferry:model/openai/gpt-4o']);
    expect(r.modelOverrides?.refiner?.model).toBe('openai/gpt-4o');
    expect(r.modelOverrides?.dev?.model).toBe('openai/gpt-4o');
    expect(r.modelOverrides?.review?.model).toBe('openai/gpt-4o');
    expect(r.modelOverrides?.iterate?.model).toBe('openai/gpt-4o');
  });

  it('blanket model applies only to phases without a per-phase override (per-phase wins)', () => {
    const r = resolveTicketOverrides([
      'ferry:model/claude-opus-4-7',
      'ferry:model/dev/claude-sonnet-4-6',
    ]);
    expect(r.modelOverrides?.dev?.model).toBe('claude-sonnet-4-6');
    expect(r.modelOverrides?.refiner?.model).toBe('claude-opus-4-7');
    expect(r.modelOverrides?.review?.model).toBe('claude-opus-4-7');
    expect(r.modelOverrides?.iterate?.model).toBe('claude-opus-4-7');
  });

  it('throws LabelConflictError when two blanket model labels conflict', () => {
    expect(() =>
      resolveTicketOverrides(['ferry:model/claude-opus-4-7', 'ferry:model/gpt-4o']),
    ).toThrow(LabelConflictError);
  });

  it('includes field "model" (not "model.<phase>") in LabelConflictError for blanket conflict', () => {
    let err: LabelConflictError | undefined;
    try {
      resolveTicketOverrides(['ferry:model/model-a', 'ferry:model/model-b']);
    } catch (e) {
      err = e as LabelConflictError;
    }
    expect(err?.field).toBe('model');
  });

  it('logs a warning and ignores malformed ferry:model label (empty name)', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:model/'], logger);
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

  it('treats ferry:provider/<provider> (one segment) as a blanket provider for all phases', () => {
    const r = resolveTicketOverrides(['ferry:provider/openai']);
    expect(r.modelOverrides?.refiner?.provider).toBe('openai');
    expect(r.modelOverrides?.dev?.provider).toBe('openai');
    expect(r.modelOverrides?.review?.provider).toBe('openai');
    expect(r.modelOverrides?.iterate?.provider).toBe('openai');
  });

  it('blanket provider applies only to phases without a per-phase provider override (per-phase wins)', () => {
    const r = resolveTicketOverrides(['ferry:provider/openai', 'ferry:provider/dev/google']);
    expect(r.modelOverrides?.dev?.provider).toBe('google');
    expect(r.modelOverrides?.refiner?.provider).toBe('openai');
    expect(r.modelOverrides?.review?.provider).toBe('openai');
    expect(r.modelOverrides?.iterate?.provider).toBe('openai');
  });

  it('throws LabelConflictError when two blanket provider labels conflict', () => {
    expect(() =>
      resolveTicketOverrides(['ferry:provider/openai', 'ferry:provider/anthropic']),
    ).toThrow(LabelConflictError);
  });

  it('includes field "provider" in LabelConflictError for blanket provider conflict', () => {
    let err: LabelConflictError | undefined;
    try {
      resolveTicketOverrides(['ferry:provider/openai', 'ferry:provider/google']);
    } catch (e) {
      err = e as LabelConflictError;
    }
    expect(err?.field).toBe('provider');
  });

  it('logs a warning and ignores unknown provider in blanket ferry:provider label', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:provider/notaprovider'], logger);
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
  it('parses ferry:skip/refiner to skipPhases ["refiner"]', () => {
    const r = resolveTicketOverrides(['ferry:skip/refiner']);
    expect(r.skipPhases).toEqual(['refiner']);
  });

  it('parses ferry:skip/dev to skipPhases ["dev"]', () => {
    const r = resolveTicketOverrides(['ferry:skip/dev']);
    expect(r.skipPhases).toEqual(['dev']);
  });

  it('parses ferry:skip/iter as an alias for the iterate phase', () => {
    const r = resolveTicketOverrides(['ferry:skip/iter']);
    expect(r.skipPhases).toEqual(['iterate']);
  });

  it('parses ferry:skip/iterate (long form) to skipPhases ["iterate"]', () => {
    const r = resolveTicketOverrides(['ferry:skip/iterate']);
    expect(r.skipPhases).toEqual(['iterate']);
  });

  it('accumulates different skip phases additively (refiner + iter)', () => {
    const r = resolveTicketOverrides(['ferry:skip/refiner', 'ferry:skip/iter']);
    expect(r.skipPhases).toContain('refiner');
    expect(r.skipPhases).toContain('iterate');
  });

  it('accumulates multiple skip phases without conflict (review opt-in on)', () => {
    const r = resolveTicketOverrides(['ferry:skip/review', 'ferry:skip/iterate'], undefined, {
      allowSkipReview: true,
    });
    expect(r.skipPhases).toContain('review');
    expect(r.skipPhases).toContain('iterate');
  });

  it('deduplicates repeated skip labels for the same phase (vacuous, no conflict)', () => {
    const r = resolveTicketOverrides(['ferry:skip/dev', 'ferry:skip/dev']);
    expect(r.skipPhases?.filter((p) => p === 'dev')).toHaveLength(1);
  });

  it('treats ferry:skip/iter and ferry:skip/iterate as the same phase (dedup)', () => {
    const r = resolveTicketOverrides(['ferry:skip/iter', 'ferry:skip/iterate']);
    expect(r.skipPhases).toEqual(['iterate']);
  });

  it('logs a warning and ignores unknown phase in ferry:skip label', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:skip/badphase'], logger);
    expect(r.skipPhases).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn')).toBe(true);
  });
});

// ------------------------------------------------------------------
// ferry:skip/review — safety opt-in
// ------------------------------------------------------------------

describe('resolveTicketOverrides — ferry:skip/review opt-in guardrail', () => {
  it('ignores ferry:skip/review when allow_skip_review is not set (default)', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:skip/review'], logger);
    expect(r.skipPhases).toBeUndefined();
    const warns = records.filter((rec) => rec.level === 'warn');
    expect(warns.length).toBeGreaterThan(0);
    expect(warns.some((rec) => /allow_skip_review/.test(rec.message))).toBe(true);
  });

  it('ignores ferry:skip/review when allowSkipReview is explicitly false', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:skip/review'], logger, {
      allowSkipReview: false,
    });
    expect(r.skipPhases).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn')).toBe(true);
  });

  it('honours ferry:skip/review when allowSkipReview is true', () => {
    const r = resolveTicketOverrides(['ferry:skip/review'], undefined, {
      allowSkipReview: true,
    });
    expect(r.skipPhases).toEqual(['review']);
  });

  it('opt-in does not affect other skip phases', () => {
    const r = resolveTicketOverrides(['ferry:skip/refiner', 'ferry:skip/review'], undefined, {
      allowSkipReview: false,
    });
    expect(r.skipPhases).toEqual(['refiner']);
  });
});

// ------------------------------------------------------------------
// ferry:no-auto-transition
// ------------------------------------------------------------------

describe('resolveTicketOverrides — ferry:no-auto-transition', () => {
  it('sets noAutoTransition to true when label is present', () => {
    const r = resolveTicketOverrides(['ferry:no-auto-transition']);
    expect(r.noAutoTransition).toBe(true);
  });

  it('does not set noAutoTransition when label is absent', () => {
    expect(resolveTicketOverrides([]).noAutoTransition).toBeUndefined();
  });

  it('combines with skipPhases additively', () => {
    const r = resolveTicketOverrides(['ferry:skip/refiner', 'ferry:no-auto-transition']);
    expect(r.skipPhases).toEqual(['refiner']);
    expect(r.noAutoTransition).toBe(true);
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

  it('sets thinking to "extended" for ferry:thinking/extended', () => {
    expect(resolveTicketOverrides(['ferry:thinking/extended']).thinking).toBe('extended');
  });

  it('throws LabelConflictError when ferry:thinking/on and ferry:thinking/off both present', () => {
    expect(() => resolveTicketOverrides(['ferry:thinking/on', 'ferry:thinking/off'])).toThrow(
      LabelConflictError,
    );
  });

  it('throws LabelConflictError when ferry:thinking/extended and ferry:thinking/off both present', () => {
    try {
      resolveTicketOverrides(['ferry:thinking/extended', 'ferry:thinking/off']);
      throw new Error('expected LabelConflictError');
    } catch (e) {
      expect(e).toBeInstanceOf(LabelConflictError);
      expect((e as LabelConflictError).field).toBe('thinking');
    }
  });

  it('throws LabelConflictError when ferry:thinking/extended and ferry:thinking/on both present', () => {
    expect(() => resolveTicketOverrides(['ferry:thinking/extended', 'ferry:thinking/on'])).toThrow(
      LabelConflictError,
    );
  });

  it('does not throw when the same thinking label appears twice', () => {
    expect(() => resolveTicketOverrides(['ferry:thinking/on', 'ferry:thinking/on'])).not.toThrow();
    expect(resolveTicketOverrides(['ferry:thinking/on', 'ferry:thinking/on']).thinking).toBe('on');
  });

  it('does not throw when ferry:thinking/extended appears twice', () => {
    expect(() =>
      resolveTicketOverrides(['ferry:thinking/extended', 'ferry:thinking/extended']),
    ).not.toThrow();
    expect(
      resolveTicketOverrides(['ferry:thinking/extended', 'ferry:thinking/extended']).thinking,
    ).toBe('extended');
  });

  it('logs a warning and ignores an unknown ferry:thinking/<unknown> suffix', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:thinking/foo'], logger);
    expect(r.thinking).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn')).toBe(true);
  });
});

// ------------------------------------------------------------------
// ferry:strict-review / ferry:lenient-review (reviewer rubric)
// ------------------------------------------------------------------

describe('resolveTicketOverrides — reviewer rubric (ferry:strict-review / ferry:lenient-review)', () => {
  it('sets reviewRubric to "strict" for ferry:strict-review', () => {
    expect(resolveTicketOverrides(['ferry:strict-review']).reviewRubric).toBe('strict');
  });

  it('sets reviewRubric to "lenient" for ferry:lenient-review', () => {
    expect(resolveTicketOverrides(['ferry:lenient-review']).reviewRubric).toBe('lenient');
  });

  it('reviewRubric is undefined when no rubric label is present', () => {
    expect(resolveTicketOverrides([]).reviewRubric).toBeUndefined();
  });

  it('throws LabelConflictError when both strict and lenient review labels are present', () => {
    try {
      resolveTicketOverrides(['ferry:strict-review', 'ferry:lenient-review']);
      throw new Error('expected LabelConflictError');
    } catch (e) {
      expect(e).toBeInstanceOf(LabelConflictError);
      expect((e as LabelConflictError).field).toBe('reviewRubric');
    }
  });

  it('does not throw when the same rubric label appears twice', () => {
    expect(() =>
      resolveTicketOverrides(['ferry:strict-review', 'ferry:strict-review']),
    ).not.toThrow();
    expect(
      resolveTicketOverrides(['ferry:strict-review', 'ferry:strict-review']).reviewRubric,
    ).toBe('strict');
  });

  it('hasNonDefaultOverrides returns true when reviewRubric is set', () => {
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:strict-review']))).toBe(true);
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
// ferry:base/<branch> / ferry:target/<branch> / ferry:pr/draft|ready
// ------------------------------------------------------------------

describe('resolveTicketOverrides — ferry:base/<branch>', () => {
  it('sets git.baseBranch from ferry:base/release-1.x', () => {
    const r = resolveTicketOverrides(['ferry:base/release-1.x']);
    expect(r.git?.baseBranch).toBe('release-1.x');
  });

  it('accepts slashes inside the branch name (e.g. feat/foo)', () => {
    const r = resolveTicketOverrides(['ferry:base/feat/foo']);
    expect(r.git?.baseBranch).toBe('feat/foo');
  });

  it('accepts dots, underscores, dashes', () => {
    const r = resolveTicketOverrides(['ferry:base/release_1.2-rc']);
    expect(r.git?.baseBranch).toBe('release_1.2-rc');
  });

  it('warns and ignores invalid branch names containing spaces', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:base/has space'], logger);
    expect(r.git?.baseBranch).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn')).toBe(true);
  });

  it('warns and ignores branch names with disallowed chars ($, etc.)', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:base/$invalid'], logger);
    expect(r.git?.baseBranch).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn')).toBe(true);
  });

  it('warns and ignores empty branch name (ferry:base/)', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:base/'], logger);
    expect(r.git?.baseBranch).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn')).toBe(true);
  });

  it('throws LabelConflictError when two different ferry:base/* labels are present', () => {
    expect(() =>
      resolveTicketOverrides(['ferry:base/release-1.x', 'ferry:base/release-2.x']),
    ).toThrow(LabelConflictError);
  });

  it('does not throw for identical duplicate ferry:base/* labels (vacuous)', () => {
    const r = resolveTicketOverrides(['ferry:base/release-1.x', 'ferry:base/release-1.x']);
    expect(r.git?.baseBranch).toBe('release-1.x');
  });

  it('records correct field name (git.baseBranch) on LabelConflictError', () => {
    try {
      resolveTicketOverrides(['ferry:base/a', 'ferry:base/b']);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(LabelConflictError);
      expect((e as LabelConflictError).field).toBe('git.baseBranch');
    }
  });
});

describe('resolveTicketOverrides — ferry:target/<branch>', () => {
  it('sets git.targetBranch from ferry:target/release-1.x', () => {
    const r = resolveTicketOverrides(['ferry:target/release-1.x']);
    expect(r.git?.targetBranch).toBe('release-1.x');
  });

  it('accepts slashes inside the branch name', () => {
    const r = resolveTicketOverrides(['ferry:target/release/v2']);
    expect(r.git?.targetBranch).toBe('release/v2');
  });

  it('warns and ignores invalid branch names', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:target/has space'], logger);
    expect(r.git?.targetBranch).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn')).toBe(true);
  });

  it('warns and ignores empty branch name (ferry:target/)', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:target/'], logger);
    expect(r.git?.targetBranch).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn')).toBe(true);
  });

  it('throws LabelConflictError when two different ferry:target/* labels are present', () => {
    expect(() => resolveTicketOverrides(['ferry:target/main', 'ferry:target/develop'])).toThrow(
      LabelConflictError,
    );
  });

  it('does not throw for identical duplicate ferry:target/* labels (vacuous)', () => {
    const r = resolveTicketOverrides(['ferry:target/main', 'ferry:target/main']);
    expect(r.git?.targetBranch).toBe('main');
  });

  it('records correct field name (git.targetBranch) on LabelConflictError', () => {
    try {
      resolveTicketOverrides(['ferry:target/a', 'ferry:target/b']);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(LabelConflictError);
      expect((e as LabelConflictError).field).toBe('git.targetBranch');
    }
  });

  it('does not conflict with ferry:base/<branch> (different fields)', () => {
    const r = resolveTicketOverrides(['ferry:base/develop', 'ferry:target/release-1.x']);
    expect(r.git?.baseBranch).toBe('develop');
    expect(r.git?.targetBranch).toBe('release-1.x');
  });
});

describe('resolveTicketOverrides — ferry:pr/draft and ferry:pr/ready', () => {
  it('sets git.prDraft to true for ferry:pr/draft', () => {
    const r = resolveTicketOverrides(['ferry:pr/draft']);
    expect(r.git?.prDraft).toBe(true);
  });

  it('sets git.prDraft to false for ferry:pr/ready', () => {
    const r = resolveTicketOverrides(['ferry:pr/ready']);
    expect(r.git?.prDraft).toBe(false);
  });

  it('throws LabelConflictError when both ferry:pr/draft and ferry:pr/ready are present', () => {
    expect(() => resolveTicketOverrides(['ferry:pr/draft', 'ferry:pr/ready'])).toThrow(
      LabelConflictError,
    );
  });

  it('records correct field name (git.prDraft) on LabelConflictError', () => {
    try {
      resolveTicketOverrides(['ferry:pr/draft', 'ferry:pr/ready']);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(LabelConflictError);
      expect((e as LabelConflictError).field).toBe('git.prDraft');
    }
  });

  it('does not throw for duplicate identical ferry:pr/draft labels', () => {
    const r = resolveTicketOverrides(['ferry:pr/draft', 'ferry:pr/draft']);
    expect(r.git?.prDraft).toBe(true);
  });

  it('warns on unknown ferry:pr/<other> suffix', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:pr/foo'], logger);
    expect(r.git?.prDraft).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn')).toBe(true);
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
    const r = resolveTicketOverrides(
      [
        'ferry:model/dev/claude-opus-4-7',
        'ferry:provider/dev/anthropic',
        'ferry:skip/review',
        'ferry:thinking/on',
      ],
      undefined,
      { allowSkipReview: true },
    );
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

  it('applies a blanket model override to all four phases', () => {
    const overrides = resolveTicketOverrides(['ferry:model/claude-opus-4-7']);
    const cfg = applyTicketOverrides(BASE_CFG, overrides);
    expect(cfg.models.refiner.model).toBe('claude-opus-4-7');
    expect(cfg.models.dev.model).toBe('claude-opus-4-7');
    expect(cfg.models.review.model).toBe('claude-opus-4-7');
    expect(cfg.models.iterate.model).toBe('claude-opus-4-7');
    // providers unchanged
    expect(cfg.models.dev.provider).toBe(BASE_CFG.models.dev.provider);
  });

  it('blanket model + per-phase model: per-phase wins for that phase, blanket fills the rest', () => {
    const overrides = resolveTicketOverrides([
      'ferry:model/claude-opus-4-7',
      'ferry:model/dev/claude-sonnet-4-6',
    ]);
    const cfg = applyTicketOverrides(BASE_CFG, overrides);
    expect(cfg.models.dev.model).toBe('claude-sonnet-4-6');
    expect(cfg.models.refiner.model).toBe('claude-opus-4-7');
    expect(cfg.models.review.model).toBe('claude-opus-4-7');
    expect(cfg.models.iterate.model).toBe('claude-opus-4-7');
  });

  it('applies a blanket provider override to all four phases', () => {
    const overrides = resolveTicketOverrides(['ferry:provider/openai']);
    const cfg = applyTicketOverrides(BASE_CFG, overrides);
    expect(cfg.models.refiner.provider).toBe('openai');
    expect(cfg.models.dev.provider).toBe('openai');
    expect(cfg.models.review.provider).toBe('openai');
    expect(cfg.models.iterate.provider).toBe('openai');
    // models unchanged
    expect(cfg.models.dev.model).toBe(BASE_CFG.models.dev.model);
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
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:skip/refiner']))).toBe(true);
  });

  it('returns true when thinking is set', () => {
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:thinking/on']))).toBe(true);
  });

  it('returns true when git.noPr is set', () => {
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:git/no-pr']))).toBe(true);
  });

  it('returns true when git.baseBranch is set', () => {
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:base/release-1.x']))).toBe(true);
  });

  it('returns true when git.targetBranch is set', () => {
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:target/release-1.x']))).toBe(true);
  });

  it('returns true when git.prDraft is set (ferry:pr/draft)', () => {
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:pr/draft']))).toBe(true);
  });

  it('returns true when git.prDraft is set to false (ferry:pr/ready)', () => {
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:pr/ready']))).toBe(true);
  });

  it('returns true when paused is set', () => {
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:paused']))).toBe(true);
  });

  it('returns true when noAutoTransition is set', () => {
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:no-auto-transition']))).toBe(true);
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

  it('includes skipPhases when ferry:skip/* labels are set', () => {
    const overrides = resolveTicketOverrides(
      ['ferry:skip/refiner', 'ferry:skip/iter', 'ferry:skip/review'],
      undefined,
      { allowSkipReview: true },
    );
    const comment = buildOverridesAuditComment('refiner', 'run1', overrides);
    expect(comment).toContain('"skipPhases"');
    expect(comment).toContain('"refiner"');
    expect(comment).toContain('"iterate"');
    expect(comment).toContain('"review"');
  });

  it('includes noAutoTransition when ferry:no-auto-transition is set', () => {
    const overrides = resolveTicketOverrides(['ferry:no-auto-transition']);
    const comment = buildOverridesAuditComment('developer', 'r1', overrides);
    expect(comment).toContain('"noAutoTransition":true');
  });

  it('includes thinking and reviewRubric when both are set', () => {
    const overrides = resolveTicketOverrides(['ferry:thinking/extended', 'ferry:strict-review']);
    const comment = buildOverridesAuditComment('reviewer', 'run1', overrides);
    expect(comment).toContain('"thinking":"extended"');
    expect(comment).toContain('"reviewRubric":"strict"');
  });

  it('includes thinking when set to "off"', () => {
    const overrides = resolveTicketOverrides(['ferry:thinking/off']);
    const comment = buildOverridesAuditComment('developer', 'run1', overrides);
    expect(comment).toContain('"thinking":"off"');
  });

  it('includes git.baseBranch when ferry:base/<branch> is set', () => {
    const overrides = resolveTicketOverrides(['ferry:base/release-1.x']);
    const comment = buildOverridesAuditComment('developer', 'run1', overrides);
    expect(comment).toContain('"baseBranch":"release-1.x"');
  });

  it('includes git.targetBranch when ferry:target/<branch> is set', () => {
    const overrides = resolveTicketOverrides(['ferry:target/release-1.x']);
    const comment = buildOverridesAuditComment('developer', 'run1', overrides);
    expect(comment).toContain('"targetBranch":"release-1.x"');
  });

  it('includes git.prDraft=true when ferry:pr/draft is set', () => {
    const overrides = resolveTicketOverrides(['ferry:pr/draft']);
    const comment = buildOverridesAuditComment('developer', 'run1', overrides);
    expect(comment).toContain('"prDraft":true');
  });

  it('includes git.prDraft=false when ferry:pr/ready is set', () => {
    const overrides = resolveTicketOverrides(['ferry:pr/ready']);
    const comment = buildOverridesAuditComment('developer', 'run1', overrides);
    expect(comment).toContain('"prDraft":false');
  });

  it('includes all four git fields together in a single audit payload', () => {
    const overrides = resolveTicketOverrides([
      'ferry:git/no-pr',
      'ferry:base/release-1.x',
      'ferry:target/release-1.x',
      'ferry:pr/draft',
    ]);
    const comment = buildOverridesAuditComment('developer', 'run1', overrides);
    expect(comment).toContain('"noPr":true');
    expect(comment).toContain('"baseBranch":"release-1.x"');
    expect(comment).toContain('"targetBranch":"release-1.x"');
    expect(comment).toContain('"prDraft":true');
  });
});

// ------------------------------------------------------------------
// ferry:budget/<eur> (short-form EUR hard cap)
// ------------------------------------------------------------------

describe('resolveTicketOverrides — ferry:budget/<eur>', () => {
  it('parses ferry:budget/3 → budgetEur = 3', () => {
    const r = resolveTicketOverrides(['ferry:budget/3']);
    expect(r.budgetEur).toBe(3);
  });

  it('parses ferry:budget/10 → budgetEur = 10', () => {
    const r = resolveTicketOverrides(['ferry:budget/10']);
    expect(r.budgetEur).toBe(10);
  });

  it('ignores and warns on malformed value ferry:budget/abc', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:budget/abc'], logger);
    expect(r.budgetEur).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn')).toBe(true);
  });

  it('ignores and warns on ferry:budget/0 (not a positive integer)', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:budget/0'], logger);
    expect(r.budgetEur).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn')).toBe(true);
  });

  it('throws LabelConflictError on duplicate ferry:budget/<eur> labels', () => {
    expect(() => resolveTicketOverrides(['ferry:budget/3', 'ferry:budget/5'])).toThrow(
      LabelConflictError,
    );
  });

  it('does not conflict with ferry:budget/max-cost/<eur> (different fields)', () => {
    const r = resolveTicketOverrides(['ferry:budget/3', 'ferry:budget/max-cost/5']);
    expect(r.budgetEur).toBe(3);
    expect(r.budget?.maxCostEurPerRun).toBe(5);
  });
});

// ------------------------------------------------------------------
// ferry:max-iterations/<n>
// ------------------------------------------------------------------

describe('resolveTicketOverrides — ferry:max-iterations/<n>', () => {
  it('parses ferry:max-iterations/50 → maxIterations = 50', () => {
    const r = resolveTicketOverrides(['ferry:max-iterations/50']);
    expect(r.maxIterations).toBe(50);
  });

  it('ignores and warns on malformed value ferry:max-iterations/abc', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:max-iterations/abc'], logger);
    expect(r.maxIterations).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn')).toBe(true);
  });

  it('ignores and warns on ferry:max-iterations/0 (not positive)', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:max-iterations/0'], logger);
    expect(r.maxIterations).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn')).toBe(true);
  });

  it('throws LabelConflictError on duplicate ferry:max-iterations labels', () => {
    expect(() =>
      resolveTicketOverrides(['ferry:max-iterations/10', 'ferry:max-iterations/20']),
    ).toThrow(LabelConflictError);
  });

  it('applies maxIterations to limits.max_agent_iterations via applyTicketOverrides', () => {
    const overrides = resolveTicketOverrides(['ferry:max-iterations/75']);
    const cfg = applyTicketOverrides(BASE_CFG, overrides);
    expect(cfg.limits.max_agent_iterations).toBe(75);
  });

  it('hasNonDefaultOverrides returns true when maxIterations is set', () => {
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:max-iterations/5']))).toBe(true);
  });
});

// ------------------------------------------------------------------
// ferry:max-tokens/<n>
// ------------------------------------------------------------------

describe('resolveTicketOverrides — ferry:max-tokens/<n>', () => {
  it('parses ferry:max-tokens/8192 → maxTokens = 8192', () => {
    const r = resolveTicketOverrides(['ferry:max-tokens/8192']);
    expect(r.maxTokens).toBe(8192);
  });

  it('ignores and warns on malformed value ferry:max-tokens/abc', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:max-tokens/abc'], logger);
    expect(r.maxTokens).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn')).toBe(true);
  });

  it('throws LabelConflictError on duplicate ferry:max-tokens labels', () => {
    expect(() =>
      resolveTicketOverrides(['ferry:max-tokens/8192', 'ferry:max-tokens/4096']),
    ).toThrow(LabelConflictError);
  });

  it('applies maxTokens to limits.max_tokens_per_message via applyTicketOverrides', () => {
    const overrides = resolveTicketOverrides(['ferry:max-tokens/4096']);
    const cfg = applyTicketOverrides(BASE_CFG, overrides);
    expect(cfg.limits.max_tokens_per_message).toBe(4096);
  });

  it('hasNonDefaultOverrides returns true when maxTokens is set', () => {
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:max-tokens/4096']))).toBe(true);
  });
});

// ------------------------------------------------------------------
// applyTicketOverrides — new fields
// ------------------------------------------------------------------

describe('applyTicketOverrides — budgetEur / maxIterations / maxTokens', () => {
  it('applies budgetEur to limits.max_cost_eur_per_run', () => {
    const overrides = resolveTicketOverrides(['ferry:budget/3']);
    const cfg = applyTicketOverrides(BASE_CFG, overrides);
    expect(cfg.limits.max_cost_eur_per_run).toBe(3);
  });

  it('returns same config reference when only skipPhases is set (no new fields)', () => {
    const overrides = resolveTicketOverrides(['ferry:skip/review']);
    expect(applyTicketOverrides(BASE_CFG, overrides)).toBe(BASE_CFG);
  });

  it('does not mutate original config when new fields are applied', () => {
    const original = BASE_CFG.limits.max_cost_eur_per_run;
    const overrides = resolveTicketOverrides(['ferry:budget/1']);
    applyTicketOverrides(BASE_CFG, overrides);
    expect(BASE_CFG.limits.max_cost_eur_per_run).toBe(original);
  });

  it('buildOverridesAuditComment includes budgetEur, maxIterations, maxTokens', () => {
    const overrides = resolveTicketOverrides([
      'ferry:budget/3',
      'ferry:max-iterations/50',
      'ferry:max-tokens/4096',
    ]);
    const comment = buildOverridesAuditComment('iterator', 'run1', overrides);
    expect(comment).toContain('"budgetEur":3');
    expect(comment).toContain('"maxIterations":50');
    expect(comment).toContain('"maxTokens":4096');
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

// ------------------------------------------------------------------
// ferry:dry-run
// ------------------------------------------------------------------

describe('resolveTicketOverrides — ferry:dry-run', () => {
  it('sets dryRun to true when ferry:dry-run label is present', () => {
    expect(resolveTicketOverrides(['ferry:dry-run']).dryRun).toBe(true);
  });

  it('does not set dryRun when label is absent', () => {
    expect(resolveTicketOverrides([]).dryRun).toBeUndefined();
  });

  it('does not set dryRun for other ferry labels', () => {
    expect(resolveTicketOverrides(['ferry:paused']).dryRun).toBeUndefined();
  });

  it('logs a warning for unknown suffix ferry:dry-run/foo', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:dry-run/foo'], logger);
    expect(r.dryRun).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn')).toBe(true);
  });

  it('hasNonDefaultOverrides returns true when dryRun is set', () => {
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:dry-run']))).toBe(true);
  });
});

// ------------------------------------------------------------------
// ferry:read-only
// ------------------------------------------------------------------

describe('resolveTicketOverrides — ferry:read-only', () => {
  it('sets readOnly to true when ferry:read-only label is present', () => {
    expect(resolveTicketOverrides(['ferry:read-only']).readOnly).toBe(true);
  });

  it('does not set readOnly when label is absent', () => {
    expect(resolveTicketOverrides([]).readOnly).toBeUndefined();
  });

  it('logs a warning for unknown suffix ferry:read-only/foo', () => {
    const { logger, records } = createTestLogger('t', 'test');
    const r = resolveTicketOverrides(['ferry:read-only/foo'], logger);
    expect(r.readOnly).toBeUndefined();
    expect(records.some((rec) => rec.level === 'warn')).toBe(true);
  });

  it('hasNonDefaultOverrides returns true when readOnly is set', () => {
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:read-only']))).toBe(true);
  });
});

// ------------------------------------------------------------------
// ferry:dry-run + ferry:read-only — combination (NOT mutually exclusive)
// ------------------------------------------------------------------

describe('resolveTicketOverrides — ferry:dry-run + ferry:read-only', () => {
  it('sets both dryRun and readOnly when both labels are present (no conflict)', () => {
    const r = resolveTicketOverrides(['ferry:dry-run', 'ferry:read-only']);
    expect(r.dryRun).toBe(true);
    expect(r.readOnly).toBe(true);
  });

  it('does not throw LabelConflictError for the combination', () => {
    expect(() => resolveTicketOverrides(['ferry:dry-run', 'ferry:read-only'])).not.toThrow();
  });
});

// ------------------------------------------------------------------
// buildOverridesAuditComment — dryRun / readOnly payload + marker
// ------------------------------------------------------------------

describe('buildOverridesAuditComment — dry-run / read-only', () => {
  it('includes dryRun in the JSON payload', () => {
    const overrides = resolveTicketOverrides(['ferry:dry-run']);
    const comment = buildOverridesAuditComment('developer', 'run1', overrides);
    expect(comment).toContain('"dryRun":true');
  });

  it('includes readOnly in the JSON payload', () => {
    const overrides = resolveTicketOverrides(['ferry:read-only']);
    const comment = buildOverridesAuditComment('developer', 'run1', overrides);
    expect(comment).toContain('"readOnly":true');
  });

  it('prepends [dry-run] marker after fingerprint when overrides.dryRun is set', () => {
    const overrides = resolveTicketOverrides(['ferry:dry-run']);
    const comment = buildOverridesAuditComment('developer', 'run1', overrides);
    expect(comment).toMatch(/^\[ferry:developer:run1\] \[dry-run\]/);
  });

  it('does not prepend [dry-run] marker when overrides.dryRun is not set', () => {
    const overrides = resolveTicketOverrides(['ferry:read-only']);
    const comment = buildOverridesAuditComment('developer', 'run1', overrides);
    expect(comment).not.toContain('[dry-run]');
  });
});

// ------------------------------------------------------------------
// applyDryRunMarker
// ------------------------------------------------------------------

describe('applyDryRunMarker', () => {
  it('prepends [dry-run] after [ferry:role:run-id] prefix when dryRun=true', () => {
    const out = applyDryRunMarker('[ferry:developer:run1] some message', true);
    expect(out).toBe('[ferry:developer:run1] [dry-run] some message');
  });

  it('returns body unchanged when dryRun=false', () => {
    const out = applyDryRunMarker('[ferry:developer:run1] some message', false);
    expect(out).toBe('[ferry:developer:run1] some message');
  });

  it('returns body unchanged when dryRun is undefined', () => {
    const out = applyDryRunMarker('[ferry:developer:run1] some message', undefined);
    expect(out).toBe('[ferry:developer:run1] some message');
  });

  it('returns body unchanged when there is no [ferry:...] prefix', () => {
    const out = applyDryRunMarker('plain body', true);
    expect(out).toBe('plain body');
  });

  it('handles multiline body correctly (marker only on first line)', () => {
    const out = applyDryRunMarker('[ferry:developer:run1] line1\nline2', true);
    expect(out).toBe('[ferry:developer:run1] [dry-run] line1\nline2');
  });
});

// ------------------------------------------------------------------
// ferry:claude-code / ferry:no-claude-code (execution-path override, #300)
// ------------------------------------------------------------------

describe('resolveTicketOverrides — direct-action execution path labels', () => {
  it('is undefined when no execution-path label is present', () => {
    expect(resolveTicketOverrides([]).executionPath).toBeUndefined();
    expect(resolveTicketOverrides([]).claudeCodePath).toBeUndefined();
  });

  it('ferry:claude-code → executionPath "claude-code"', () => {
    const out = resolveTicketOverrides(['ferry:claude-code']);
    expect(out.executionPath).toBe('claude-code');
    expect(out.claudeCodePath).toBe('claude-code');
  });

  it('ferry:codex-cli → executionPath "codex-cli"', () => {
    const out = resolveTicketOverrides(['ferry:codex-cli']);
    expect(out.executionPath).toBe('codex-cli');
    expect(out.claudeCodePath).toBeUndefined();
  });

  it('negative direct-action labels → executionPath "script"', () => {
    expect(resolveTicketOverrides(['ferry:no-claude-code']).executionPath).toBe('script');
    expect(resolveTicketOverrides(['ferry:no-codex-cli']).executionPath).toBe('script');
  });

  it('conflicting labels resolve to the safe path (script) WITHOUT throwing', () => {
    expect(() =>
      resolveTicketOverrides(['ferry:claude-code', 'ferry:no-claude-code']),
    ).not.toThrow();
    expect(
      resolveTicketOverrides(['ferry:claude-code', 'ferry:no-claude-code']).executionPath,
    ).toBe('script');
    // order-independent
    expect(
      resolveTicketOverrides(['ferry:no-claude-code', 'ferry:claude-code']).executionPath,
    ).toBe('script');
  });

  it('conflicting positive direct-action labels resolve to script', () => {
    expect(resolveTicketOverrides(['ferry:claude-code', 'ferry:codex-cli']).executionPath).toBe(
      'script',
    );
  });

  it('does not emit an unknown-label warning for direct-action labels', () => {
    const { logger, records } = createTestLogger('t', 'test');
    resolveTicketOverrides(
      ['ferry:claude-code', 'ferry:no-claude-code', 'ferry:codex-cli', 'ferry:no-codex-cli'],
      logger,
    );
    expect(records.some((rec) => rec.level === 'warn')).toBe(false);
  });

  it('counts toward hasNonDefaultOverrides', () => {
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:claude-code']))).toBe(true);
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:no-claude-code']))).toBe(true);
    expect(hasNonDefaultOverrides(resolveTicketOverrides(['ferry:codex-cli']))).toBe(true);
  });

  it('is recorded in the overrides audit comment', () => {
    const body = buildOverridesAuditComment(
      'developer',
      'run1',
      resolveTicketOverrides(['ferry:claude-code']),
    );
    expect(body).toContain('[ferry:developer:run1] overrides applied:');
    expect(JSON.parse(body.split('overrides applied: ')[1])).toMatchObject({
      executionPath: 'claude-code',
      claudeCodePath: 'claude-code',
    });
  });
});
