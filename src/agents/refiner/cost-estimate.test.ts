import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadCostBaseline, estimateTicketCost } from './cost-estimate.js';
import type { CostBaseline } from '../../cli/cost/stats.js';
import type { RefinerOutput } from './schema.js';

// We mock 'node:fs' to control readFileSync without touching the real filesystem.
vi.mock('node:fs');

import { readFileSync } from 'node:fs';
const mockedReadFileSync = vi.mocked(readFileSync);

const validBaseline: CostBaseline = {
  repo: 'org/repo',
  generatedAt: '2026-05-01T00:00:00Z',
  windowRuns: 20,
  byPhase: [
    { phase: 'refiner', runs: 20, medianUsd: 0.05, p90Usd: 0.1, medianInputTokens: 1000 },
    { phase: 'developer', runs: 20, medianUsd: 0.5, p90Usd: 1.0, medianInputTokens: 10000 },
  ],
};

const noopPlan: RefinerOutput = {
  actions: [{ type: 'noop', reason: 'Nothing to do' }],
  touch_paths: [],
  output_locale: 'en',
  audit_summary: 'No changes needed',
};

const multiCreatePlan: RefinerOutput = {
  actions: [
    { type: 'create', title: 'Task A', description: 'Do A' },
    { type: 'create', title: 'Task B', description: 'Do B' },
  ],
  touch_paths: ['src/a.ts', 'src/b.ts'],
  output_locale: 'en',
  audit_summary: 'Two tasks planned',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadCostBaseline', () => {
  it('returns null when cost-baseline.json does not exist (ENOENT)', () => {
    const enoentErr = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockedReadFileSync.mockImplementation(() => {
      throw enoentErr;
    });

    const result = loadCostBaseline('/repo/root');
    expect(result).toBeNull();
  });

  it('re-throws non-ENOENT errors (e.g. EACCES)', () => {
    const eaccesErr = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    mockedReadFileSync.mockImplementation(() => {
      throw eaccesErr;
    });

    expect(() => loadCostBaseline('/repo/root')).toThrow('EACCES');
  });

  it('returns parsed baseline when file exists with valid JSON', () => {
    mockedReadFileSync.mockReturnValue(JSON.stringify(validBaseline));

    const result = loadCostBaseline('/repo/root');
    expect(result).toEqual(validBaseline);
  });

  it('throws when file exists but contains invalid JSON', () => {
    mockedReadFileSync.mockReturnValue('not valid json {{{');

    expect(() => loadCostBaseline('/repo/root')).toThrow();
  });
});

describe('estimateTicketCost', () => {
  describe('confidence levels based on windowRuns', () => {
    it('returns low confidence when baseline has fewer than 10 runs', () => {
      const baseline: CostBaseline = { ...validBaseline, windowRuns: 5 };
      const result = estimateTicketCost(noopPlan, baseline);
      expect(result.confidence).toBe('low');
      expect(result.baselineRuns).toBe(5);
    });

    it('returns medium confidence when baseline has 10–49 runs', () => {
      const baseline: CostBaseline = { ...validBaseline, windowRuns: 20 };
      const result = estimateTicketCost(noopPlan, baseline);
      expect(result.confidence).toBe('medium');
      expect(result.baselineRuns).toBe(20);
    });

    it('returns medium confidence at exactly 49 runs (boundary)', () => {
      const baseline: CostBaseline = { ...validBaseline, windowRuns: 49 };
      const result = estimateTicketCost(noopPlan, baseline);
      expect(result.confidence).toBe('medium');
    });

    it('returns high confidence when baseline has 50 or more runs', () => {
      const baseline: CostBaseline = { ...validBaseline, windowRuns: 50 };
      const result = estimateTicketCost(noopPlan, baseline);
      expect(result.confidence).toBe('high');
      expect(result.baselineRuns).toBe(50);
    });

    it('returns low confidence at boundary of 9 runs', () => {
      const baseline: CostBaseline = { ...validBaseline, windowRuns: 9 };
      const result = estimateTicketCost(noopPlan, baseline);
      expect(result.confidence).toBe('low');
    });

    it('returns medium confidence at exactly 10 runs (boundary)', () => {
      const baseline: CostBaseline = { ...validBaseline, windowRuns: 10 };
      const result = estimateTicketCost(noopPlan, baseline);
      expect(result.confidence).toBe('medium');
    });
  });

  describe('cost calculation', () => {
    it('applies iteration factor (1.4x) to developer and iterator phases for hiUsd', () => {
      const baseline: CostBaseline = {
        ...validBaseline,
        byPhase: [
          { phase: 'refiner', runs: 20, medianUsd: 0.05, p90Usd: 0.1, medianInputTokens: 1000 },
          { phase: 'developer', runs: 20, medianUsd: 0.5, p90Usd: 1.0, medianInputTokens: 10000 },
          { phase: 'iterator', runs: 20, medianUsd: 0.2, p90Usd: 0.4, medianInputTokens: 5000 },
        ],
      };

      const result = estimateTicketCost(multiCreatePlan, baseline);

      // loUsd = sum of all medians (no factor applied)
      expect(result.loUsd).toBeCloseTo(0.05 + 0.5 + 0.2);

      // hiUsd = refiner p90 (×1) + developer p90 (×1.4) + iterator p90 (×1.4)
      const expectedHi = 0.1 * 1 + 1.0 * 1.4 + 0.4 * 1.4;
      expect(result.hiUsd).toBeCloseTo(expectedHi);
    });

    it('does not apply iteration factor to non-iterated phases', () => {
      const baseline: CostBaseline = {
        ...validBaseline,
        byPhase: [
          { phase: 'refiner', runs: 20, medianUsd: 0.05, p90Usd: 0.1, medianInputTokens: 1000 },
          { phase: 'reviewer', runs: 20, medianUsd: 0.1, p90Usd: 0.2, medianInputTokens: 2000 },
        ],
      };

      const result = estimateTicketCost(noopPlan, baseline);

      // hiUsd = p90 sum with factor=1 for both phases
      expect(result.hiUsd).toBeCloseTo(0.1 + 0.2);
    });

    it('returns zero loUsd and hiUsd when baseline has no phases', () => {
      const baseline: CostBaseline = { ...validBaseline, byPhase: [] };
      const result = estimateTicketCost(noopPlan, baseline);
      expect(result.loUsd).toBe(0);
      expect(result.hiUsd).toBe(0);
    });

    it('handles dev phase alias (same as developer) with iteration factor', () => {
      const baseline: CostBaseline = {
        ...validBaseline,
        byPhase: [
          { phase: 'dev', runs: 20, medianUsd: 0.5, p90Usd: 1.0, medianInputTokens: 10000 },
        ],
      };

      const result = estimateTicketCost(noopPlan, baseline);
      // dev is an iterated phase — factor 1.4 applied to hiUsd
      expect(result.hiUsd).toBeCloseTo(1.0 * 1.4);
      expect(result.loUsd).toBeCloseTo(0.5);
    });

    it('handles iterate phase alias (same as iterator) with iteration factor', () => {
      const baseline: CostBaseline = {
        ...validBaseline,
        byPhase: [
          { phase: 'iterate', runs: 20, medianUsd: 0.2, p90Usd: 0.4, medianInputTokens: 5000 },
        ],
      };

      const result = estimateTicketCost(noopPlan, baseline);
      expect(result.hiUsd).toBeCloseTo(0.4 * 1.4);
      expect(result.loUsd).toBeCloseTo(0.2);
    });

    it('sums multiple phases correctly with mixed iterated and non-iterated', () => {
      const baseline: CostBaseline = {
        ...validBaseline,
        windowRuns: 60,
        byPhase: [
          { phase: 'refiner', runs: 60, medianUsd: 0.05, p90Usd: 0.1, medianInputTokens: 1000 },
          { phase: 'developer', runs: 60, medianUsd: 0.5, p90Usd: 1.0, medianInputTokens: 10000 },
        ],
      };

      const result = estimateTicketCost(multiCreatePlan, baseline);

      expect(result.loUsd).toBeCloseTo(0.55);
      // developer is iterated: 0.1 + 1.0 * 1.4
      expect(result.hiUsd).toBeCloseTo(0.1 + 1.4);
      expect(result.confidence).toBe('high');
    });
  });
});
