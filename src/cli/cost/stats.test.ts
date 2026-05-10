import { describe, it, expect } from 'vitest';
import { computeBaseline } from './stats.js';
import { EUR_TO_USD } from '../../lib/llm/pricing.js';
import type { AuditLine } from './types.js';

function makeAuditLine(phase: string, cost_eur: number, input_tokens = 1000): AuditLine {
  return {
    ticket: 'PROJ-1',
    phase,
    run_id: `run-${Math.random()}`,
    model: 'anthropic/claude-sonnet-4-6',
    input_tokens,
    output_tokens: 100,
    cost_eur,
    outcome: 'success',
    duration_ms: 5000,
    timestamp: '2026-05-01T00:00:00Z',
  };
}

// 5 refiner lines with cost_eur: 0.10, 0.20, 0.30, 0.40, 0.50
// 5 developer lines with cost_eur: 0.50, 1.00, 1.50, 2.00, 2.50
const fixtureLines: AuditLine[] = [
  makeAuditLine('refiner', 0.1, 500),
  makeAuditLine('refiner', 0.2, 1000),
  makeAuditLine('refiner', 0.3, 1500),
  makeAuditLine('refiner', 0.4, 2000),
  makeAuditLine('refiner', 0.5, 2500),
  makeAuditLine('developer', 0.5, 5000),
  makeAuditLine('developer', 1.0, 10000),
  makeAuditLine('developer', 1.5, 15000),
  makeAuditLine('developer', 2.0, 20000),
  makeAuditLine('developer', 2.5, 25000),
];

describe('computeBaseline', () => {
  it('returns 2 byPhase entries for 2 distinct phases', () => {
    const baseline = computeBaseline(fixtureLines, 'org/repo');
    expect(baseline.byPhase).toHaveLength(2);
  });

  it('sets windowRuns to total number of lines', () => {
    const baseline = computeBaseline(fixtureLines, 'org/repo');
    expect(baseline.windowRuns).toBe(10);
  });

  it('sets repo and generatedAt', () => {
    const baseline = computeBaseline(fixtureLines, 'org/repo');
    expect(baseline.repo).toBe('org/repo');
    expect(typeof baseline.generatedAt).toBe('string');
  });

  it('computes correct median USD for refiner phase', () => {
    const baseline = computeBaseline(fixtureLines, 'org/repo');
    const refiner = baseline.byPhase.find((p) => p.phase === 'refiner');
    expect(refiner).toBeDefined();
    // sorted: 0.10, 0.20, 0.30, 0.40, 0.50 → median = 0.30 EUR → USD
    const expectedMedianUsd = 0.3 * EUR_TO_USD;
    expect(refiner!.medianUsd).toBeCloseTo(expectedMedianUsd, 5);
  });

  it('computes correct p90 USD for refiner phase', () => {
    const baseline = computeBaseline(fixtureLines, 'org/repo');
    const refiner = baseline.byPhase.find((p) => p.phase === 'refiner');
    expect(refiner).toBeDefined();
    // sorted: 0.10, 0.20, 0.30, 0.40, 0.50 → p90 index = floor(5*0.9)=4 → 0.50 EUR
    const expectedP90Usd = 0.5 * EUR_TO_USD;
    expect(refiner!.p90Usd).toBeCloseTo(expectedP90Usd, 5);
  });

  it('computes correct median USD for developer phase', () => {
    const baseline = computeBaseline(fixtureLines, 'org/repo');
    const developer = baseline.byPhase.find((p) => p.phase === 'developer');
    expect(developer).toBeDefined();
    // sorted: 0.50, 1.00, 1.50, 2.00, 2.50 → median = 1.50 EUR
    const expectedMedianUsd = 1.5 * EUR_TO_USD;
    expect(developer!.medianUsd).toBeCloseTo(expectedMedianUsd, 5);
  });

  it('computes correct p90 USD for developer phase', () => {
    const baseline = computeBaseline(fixtureLines, 'org/repo');
    const developer = baseline.byPhase.find((p) => p.phase === 'developer');
    expect(developer).toBeDefined();
    // sorted: 0.50, 1.00, 1.50, 2.00, 2.50 → p90 index = 4 → 2.50 EUR
    const expectedP90Usd = 2.5 * EUR_TO_USD;
    expect(developer!.p90Usd).toBeCloseTo(expectedP90Usd, 5);
  });

  it('computes correct medianInputTokens for refiner phase', () => {
    const baseline = computeBaseline(fixtureLines, 'org/repo');
    const refiner = baseline.byPhase.find((p) => p.phase === 'refiner');
    expect(refiner).toBeDefined();
    // sorted: 500, 1000, 1500, 2000, 2500 → median = 1500
    expect(refiner!.medianInputTokens).toBe(1500);
  });

  it('returns runs count per phase', () => {
    const baseline = computeBaseline(fixtureLines, 'org/repo');
    const refiner = baseline.byPhase.find((p) => p.phase === 'refiner');
    const developer = baseline.byPhase.find((p) => p.phase === 'developer');
    expect(refiner!.runs).toBe(5);
    expect(developer!.runs).toBe(5);
  });

  it('handles empty lines', () => {
    const baseline = computeBaseline([], 'org/repo');
    expect(baseline.byPhase).toHaveLength(0);
    expect(baseline.windowRuns).toBe(0);
  });
});
