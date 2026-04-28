import { describe, expect, it } from 'vitest';
import { evaluateDailyCheck, formatSpendAlert } from './daily-check.js';

describe('daily spend check', () => {
  it('emits ok when all providers under 50%', () => {
    const out = evaluateDailyCheck({
      capEur: 200,
      providers: [
        { name: 'anthropic', monthly_eur: 30, daily_eur: 1 },
        { name: 'google', monthly_eur: 40, daily_eur: 1 },
      ],
    });
    expect(out.outcome).toBe('ok');
    expect(out.alerts).toEqual([]);
  });

  it('emits alert for any provider at >= 50% of cap', () => {
    const out = evaluateDailyCheck({
      capEur: 200,
      providers: [
        { name: 'anthropic', monthly_eur: 103.4, daily_eur: 8.2 },
        { name: 'google', monthly_eur: 40, daily_eur: 1 },
      ],
    });
    expect(out.outcome).toBe('alert');
    expect(out.alerts).toHaveLength(1);
    expect(out.alerts[0].provider).toBe('anthropic');
    expect(out.alerts[0].percent).toBeCloseTo(51.7, 1);
  });

  it('alert text contains provider, percent, cap, and daily figures', () => {
    const text = formatSpendAlert({
      provider: 'anthropic',
      percent: 52,
      monthly_eur: 103.4,
      cap_eur: 200,
      daily_eur: 8.2,
    });
    expect(text).toContain('anthropic');
    expect(text).toContain('52%');
    expect(text).toContain('€200.00');
    expect(text).toContain('€103.40');
    expect(text).toContain('€8.20');
  });

  it('alerts at exactly 50.0% of cap (boundary)', () => {
    const out = evaluateDailyCheck({
      capEur: 200,
      providers: [{ name: 'anthropic', monthly_eur: 100, daily_eur: 1 }],
    });
    expect(out.outcome).toBe('alert');
    expect(out.alerts).toHaveLength(1);
    expect(out.alerts[0].percent).toBeCloseTo(50, 1);
  });

  it('does NOT alert at 49.99% of cap (just-below boundary)', () => {
    const out = evaluateDailyCheck({
      capEur: 200,
      providers: [{ name: 'anthropic', monthly_eur: 99.98, daily_eur: 1 }],
    });
    expect(out.outcome).toBe('ok');
    expect(out.alerts).toEqual([]);
  });

  it('clamps negative spend to €0.00 in formatted output', () => {
    const text = formatSpendAlert({
      provider: 'google',
      percent: 0,
      monthly_eur: -1,
      cap_eur: 200,
      daily_eur: -2,
    });
    expect(text).toContain('€0.00');
  });
});
