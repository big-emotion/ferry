import { describe, it, expect, afterEach, vi } from 'vitest';
import { createSessionBudget } from './budget.js';

describe('createSessionBudget', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('checkBefore', () => {
    it('does not throw when estimated cost is within cap', () => {
      const budget = createSessionBudget(10.0);
      expect(() => budget.checkBefore(5.0)).not.toThrow();
    });

    it('throws FerryError("spend-cap") when estimated cost would exceed cap', () => {
      const budget = createSessionBudget(1.0);
      expect(() => budget.checkBefore(2.0)).toThrow(
        expect.objectContaining({
          code: 'spend-cap',
          context: expect.objectContaining({ reason: 'budget-exceeded' }),
        }),
      );
    });

    it('throws when accumulated cost + estimated would exceed cap', () => {
      const budget = createSessionBudget(1.0);
      budget.recordUsage(0.8);
      expect(() => budget.checkBefore(0.3)).toThrow(
        expect.objectContaining({
          code: 'spend-cap',
          context: expect.objectContaining({
            reason: 'budget-exceeded',
            cap: 1.0,
          }),
        }),
      );
    });

    it('does not throw when accumulated + estimated is exactly at cap', () => {
      const budget = createSessionBudget(1.0);
      budget.recordUsage(0.5);
      expect(() => budget.checkBefore(0.5)).not.toThrow();
    });

    it('includes sessionTotal and estimatedAdd in thrown context', () => {
      const budget = createSessionBudget(1.0);
      budget.recordUsage(0.6);
      let caught: unknown;
      try {
        budget.checkBefore(0.5);
      } catch (e) {
        caught = e;
      }
      expect(caught).toMatchObject({
        code: 'spend-cap',
        context: {
          reason: 'budget-exceeded',
          sessionTotal: 0.6,
          estimatedAdd: 0.5,
          cap: 1.0,
        },
      });
    });
  });

  describe('recordUsage', () => {
    it('accumulates cost across multiple calls', () => {
      const budget = createSessionBudget(10.0);
      budget.recordUsage(1.5);
      budget.recordUsage(2.0);
      budget.recordUsage(0.5);
      expect(budget.totalCostEur()).toBe(4.0);
    });

    it('starts at zero', () => {
      const budget = createSessionBudget(10.0);
      expect(budget.totalCostEur()).toBe(0);
    });
  });

  describe('default cap from env var', () => {
    it('uses FERRY_MAX_COST_EUR_PER_RUN when set', () => {
      vi.stubEnv('FERRY_MAX_COST_EUR_PER_RUN', '2');
      const budget = createSessionBudget();
      expect(() => budget.checkBefore(3.0)).toThrow(expect.objectContaining({ code: 'spend-cap' }));
    });

    it('falls back to 10.0 when env var is not set', () => {
      vi.stubEnv('FERRY_MAX_COST_EUR_PER_RUN', '');
      const budget = createSessionBudget();
      budget.recordUsage(9.0);
      expect(() => budget.checkBefore(1.5)).toThrow(expect.objectContaining({ code: 'spend-cap' }));
      expect(() => budget.checkBefore(0.9)).not.toThrow();
    });

    it('falls back to 10.0 when env var is absent', () => {
      const budget = createSessionBudget();
      // 9 + 9 = 18 > 10, but each individual call: first 9 < 10 ok, then 9+9=18 > 10
      budget.recordUsage(9.0);
      expect(() => budget.checkBefore(1.5)).toThrow(expect.objectContaining({ code: 'spend-cap' }));
    });
  });

  describe('each call returns fresh instance', () => {
    it('two budgets do not share state', () => {
      const b1 = createSessionBudget(1.0);
      const b2 = createSessionBudget(1.0);
      b1.recordUsage(0.9);
      expect(b2.totalCostEur()).toBe(0);
    });
  });
});
