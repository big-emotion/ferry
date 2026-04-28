import { describe, it, expect } from 'vitest';
import { computeCostEur } from './pricing.js';

describe('computeCostEur', () => {
  describe('Anthropic models', () => {
    it('computes cost for claude-sonnet-4-6 (exact match)', () => {
      // 1M input @ 2.79 + 1M output @ 13.95 = 16.74
      const cost = computeCostEur('anthropic', 'claude-sonnet-4-6', 1_000_000, 1_000_000);
      expect(cost).toBe(16.74);
    });

    it('computes cost for claude-opus model (prefix match)', () => {
      // 1M input @ 13.95 + 1M output @ 69.75 = 83.7
      const cost = computeCostEur('anthropic', 'claude-opus-4-7', 1_000_000, 1_000_000);
      expect(cost).toBe(83.7);
    });

    it('computes cost for claude-haiku model (prefix match)', () => {
      // 1M input @ 0.23 + 1M output @ 1.16 = 1.39
      const cost = computeCostEur('anthropic', 'claude-haiku-4-5-20251001', 1_000_000, 1_000_000);
      expect(cost).toBe(1.39);
    });

    it('uses highest anthropic rate for unknown model', () => {
      // Fallback = claude-opus rates: 1M input @ 13.95 + 1M output @ 69.75 = 83.7
      const cost = computeCostEur('anthropic', 'claude-unknown-model', 1_000_000, 1_000_000);
      expect(cost).toBe(83.7);
    });
  });

  describe('OpenAI models', () => {
    it('computes cost for gpt-4.1-mini (exact match)', () => {
      // 1M input @ 0.14 + 1M output @ 0.56 = 0.7
      const cost = computeCostEur('openai', 'gpt-4.1-mini', 1_000_000, 1_000_000);
      expect(cost).toBe(0.7);
    });

    it('computes cost for gpt-4.1 (prefix match gpt-4.)', () => {
      // 1M input @ 2.79 + 1M output @ 8.37 = 11.16
      const cost = computeCostEur('openai', 'gpt-4.1', 1_000_000, 1_000_000);
      expect(cost).toBe(11.16);
    });

    it('computes cost for gpt-5 model (prefix match gpt-5.)', () => {
      const cost = computeCostEur('openai', 'gpt-5.0', 1_000_000, 1_000_000);
      expect(cost).toBe(11.16);
    });

    it('uses highest openai rate for unknown model', () => {
      // Fallback = gpt-4.* rates: 11.16
      const cost = computeCostEur('openai', 'gpt-unknown', 1_000_000, 1_000_000);
      expect(cost).toBe(11.16);
    });
  });

  describe('Google models', () => {
    it('computes cost for gemini-2.5-flash (exact match)', () => {
      // 1M input @ 0.07 + 1M output @ 0.28 = 0.35
      const cost = computeCostEur('google', 'gemini-2.5-flash', 1_000_000, 1_000_000);
      expect(cost).toBe(0.35);
    });

    it('computes cost for gemini-2.5-pro (exact match)', () => {
      // 1M input @ 1.05 + 1M output @ 4.20 = 5.25
      const cost = computeCostEur('google', 'gemini-2.5-pro', 1_000_000, 1_000_000);
      expect(cost).toBe(5.25);
    });

    it('uses highest google rate for unknown model', () => {
      // Fallback = gemini-2.5-pro rates: 5.25
      const cost = computeCostEur('google', 'gemini-unknown', 1_000_000, 1_000_000);
      expect(cost).toBe(5.25);
    });
  });

  describe('rounding', () => {
    it('rounds to 4 decimal places', () => {
      // 100 input @ 2.79/1M + 50 output @ 13.95/1M
      // = 0.000279 + 0.0006975 = 0.0009765 → 0.0010
      const cost = computeCostEur('anthropic', 'claude-sonnet-4-6', 100, 50);
      expect(cost).toBe(0.001);
    });

    it('returns 0 for zero tokens', () => {
      expect(computeCostEur('anthropic', 'claude-sonnet-4-6', 0, 0)).toBe(0);
    });
  });
});
