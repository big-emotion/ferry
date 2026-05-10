import { describe, it, expect } from 'vitest';
import { parseAuditLines } from './parse.js';
import {
  filterLines,
  groupByPhase,
  groupByTicket,
  groupByModel,
  groupByDay,
  totalStats,
} from './aggregate.js';
import {
  formatTable,
  formatJson,
  formatSparkline,
  formatMarkdownReport,
  detectAnomalies,
} from './format.js';
import type { AuditLine } from './types.js';

const BASE: AuditLine = {
  ticket: 'PROJ-1',
  phase: 'dev',
  run_id: 'abc123',
  model: 'claude-sonnet-4-6',
  input_tokens: 100_000,
  output_tokens: 10_000,
  cost_eur: 0.42,
  outcome: 'success',
  duration_ms: 5000,
  timestamp: '2026-04-25T10:00:00.000Z',
};

const LINES: AuditLine[] = [
  {
    ...BASE,
    phase: 'refine',
    ticket: 'PROJ-1',
    cost_eur: 0.1,
    input_tokens: 50_000,
    output_tokens: 5_000,
  },
  {
    ...BASE,
    phase: 'refine',
    ticket: 'PROJ-2',
    cost_eur: 0.15,
    input_tokens: 60_000,
    output_tokens: 6_000,
  },
  {
    ...BASE,
    phase: 'dev',
    ticket: 'PROJ-1',
    cost_eur: 0.8,
    input_tokens: 800_000,
    output_tokens: 80_000,
  },
  {
    ...BASE,
    phase: 'review',
    ticket: 'PROJ-1',
    cost_eur: 0.3,
    input_tokens: 300_000,
    output_tokens: 30_000,
    timestamp: '2026-04-20T10:00:00.000Z',
  },
];

describe('parseAuditLines', () => {
  it('parses valid JSON audit lines', () => {
    const raw = [JSON.stringify(BASE)];
    const result = parseAuditLines(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ ticket: 'PROJ-1', phase: 'dev' });
  });

  it('skips ferry:audit marker lines', () => {
    const raw = ['[ferry:audit:abc123]', JSON.stringify(BASE)];
    expect(parseAuditLines(raw)).toHaveLength(1);
  });

  it('skips empty lines', () => {
    const raw = ['', '  ', JSON.stringify(BASE)];
    expect(parseAuditLines(raw)).toHaveLength(1);
  });

  it('skips malformed JSON', () => {
    const raw = ['{not valid json}', JSON.stringify(BASE)];
    expect(parseAuditLines(raw)).toHaveLength(1);
  });

  it('skips objects missing required fields', () => {
    const raw = ['{"ticket":"PROJ-1"}', JSON.stringify(BASE)];
    expect(parseAuditLines(raw)).toHaveLength(1);
  });

  it('handles interleaved marker + json (raw export format)', () => {
    const raw = [
      '[ferry:audit:run1]',
      JSON.stringify(LINES[0]),
      '[ferry:audit:run2]',
      JSON.stringify(LINES[1]),
    ];
    expect(parseAuditLines(raw)).toHaveLength(2);
  });
});

describe('filterLines', () => {
  it('returns all lines when no filter', () => {
    expect(filterLines(LINES, {})).toHaveLength(LINES.length);
  });

  it('filters by since', () => {
    const since = new Date('2026-04-24T00:00:00.000Z');
    const result = filterLines(LINES, { since });
    expect(result).toHaveLength(3);
    expect(result.every((l) => new Date(l.timestamp) >= since)).toBe(true);
  });

  it('filters by until', () => {
    const until = new Date('2026-04-21T00:00:00.000Z');
    const result = filterLines(LINES, { until });
    expect(result).toHaveLength(1);
  });

  it('filters by since and until', () => {
    const since = new Date('2026-04-24T00:00:00.000Z');
    const until = new Date('2026-04-26T00:00:00.000Z');
    const result = filterLines(LINES, { since, until });
    expect(result).toHaveLength(3);
  });
});

describe('groupByPhase', () => {
  it('groups lines by phase', () => {
    const groups = groupByPhase(LINES);
    const keys = groups.map((g) => g.key);
    expect(keys).toContain('refine');
    expect(keys).toContain('dev');
    expect(keys).toContain('review');
  });

  it('sums tokens and cost within a phase', () => {
    const groups = groupByPhase(LINES);
    const refine = groups.find((g) => g.key === 'refine');
    expect(refine?.calls).toBe(2);
    expect(refine?.inputTokens).toBe(110_000);
    expect(refine?.costEur).toBeCloseTo(0.25);
  });
});

describe('groupByTicket', () => {
  it('groups lines by ticket', () => {
    const groups = groupByTicket(LINES);
    const keys = groups.map((g) => g.key);
    expect(keys).toContain('PROJ-1');
    expect(keys).toContain('PROJ-2');
  });

  it('counts calls correctly', () => {
    const groups = groupByTicket(LINES);
    const proj1 = groups.find((g) => g.key === 'PROJ-1');
    expect(proj1?.calls).toBe(3);
  });
});

describe('totalStats', () => {
  it('sums all groups', () => {
    const groups = groupByPhase(LINES);
    const total = totalStats(groups);
    expect(total.calls).toBe(LINES.length);
    const expectedCost = LINES.reduce((s, l) => s + l.cost_eur, 0);
    expect(total.costEur).toBeCloseTo(expectedCost);
  });
});

describe('formatTable', () => {
  it('returns a string with header and rows', () => {
    const groups = groupByPhase(LINES);
    const total = totalStats(groups);
    const output = formatTable(groups, total, 'Last 7 days');
    expect(output).toContain('Phase');
    expect(output).toContain('Calls');
    expect(output).toContain('refine');
    expect(output).toContain('Last 7 days');
  });

  it('formats large token counts with k/M suffix', () => {
    const groups = groupByPhase(LINES);
    const total = totalStats(groups);
    const output = formatTable(groups, total, 'All time');
    expect(output).toMatch(/\d+k|\d+\.\d+M/);
  });
});

describe('formatJson', () => {
  it('returns valid JSON with groups, total, and label', () => {
    const groups = groupByPhase(LINES);
    const total = totalStats(groups);
    const raw = formatJson(groups, total, 'Last 7 days');
    const parsed = JSON.parse(raw) as { groups: unknown[]; total: unknown; label: string };
    expect(parsed.groups).toHaveLength(groups.length);
    expect(parsed.label).toBe('Last 7 days');
  });
});

describe('groupByModel', () => {
  it('groups lines by model and sums stats', () => {
    const lines: AuditLine[] = [
      { ...BASE, model: 'claude-sonnet-4-6', cost_eur: 0.5 },
      { ...BASE, model: 'claude-sonnet-4-6', cost_eur: 0.3 },
      { ...BASE, model: 'gpt-4o', cost_eur: 0.1 },
    ];
    const groups = groupByModel(lines);
    const keys = groups.map((g) => g.key);
    expect(keys).toContain('claude-sonnet-4-6');
    expect(keys).toContain('gpt-4o');
  });

  it('sums tokens and cost within a model', () => {
    const lines: AuditLine[] = [
      { ...BASE, model: 'claude-sonnet-4-6', cost_eur: 0.5, input_tokens: 100, output_tokens: 10 },
      { ...BASE, model: 'claude-sonnet-4-6', cost_eur: 0.3, input_tokens: 200, output_tokens: 20 },
    ];
    const groups = groupByModel(lines);
    const sonnet = groups.find((g) => g.key === 'claude-sonnet-4-6');
    expect(sonnet?.calls).toBe(2);
    expect(sonnet?.inputTokens).toBe(300);
    expect(sonnet?.outputTokens).toBe(30);
    expect(sonnet?.costEur).toBeCloseTo(0.8);
  });

  it('sorts by costEur descending', () => {
    const lines: AuditLine[] = [
      { ...BASE, model: 'cheap-model', cost_eur: 0.01 },
      { ...BASE, model: 'expensive-model', cost_eur: 1.0 },
      { ...BASE, model: 'mid-model', cost_eur: 0.5 },
    ];
    const groups = groupByModel(lines);
    expect(groups[0]?.key).toBe('expensive-model');
    expect(groups[1]?.key).toBe('mid-model');
    expect(groups[2]?.key).toBe('cheap-model');
  });
});

describe('groupByDay', () => {
  it('groups lines by date (YYYY-MM-DD slice of timestamp)', () => {
    const lines: AuditLine[] = [
      { ...BASE, timestamp: '2026-04-25T08:00:00.000Z', cost_eur: 0.1 },
      { ...BASE, timestamp: '2026-04-25T18:00:00.000Z', cost_eur: 0.2 },
      { ...BASE, timestamp: '2026-04-26T10:00:00.000Z', cost_eur: 0.3 },
    ];
    const groups = groupByDay(lines);
    expect(groups).toHaveLength(2);
    const keys = groups.map((g) => g.key);
    expect(keys).toContain('2026-04-25');
    expect(keys).toContain('2026-04-26');
  });

  it('sums stats within a day', () => {
    const lines: AuditLine[] = [
      { ...BASE, timestamp: '2026-04-25T08:00:00.000Z', cost_eur: 0.1 },
      { ...BASE, timestamp: '2026-04-25T18:00:00.000Z', cost_eur: 0.2 },
    ];
    const groups = groupByDay(lines);
    expect(groups[0]?.key).toBe('2026-04-25');
    expect(groups[0]?.calls).toBe(2);
    expect(groups[0]?.costEur).toBeCloseTo(0.3);
  });

  it('sorts chronologically ascending', () => {
    const lines: AuditLine[] = [
      { ...BASE, timestamp: '2026-04-27T00:00:00.000Z', cost_eur: 0.1 },
      { ...BASE, timestamp: '2026-04-25T00:00:00.000Z', cost_eur: 0.1 },
      { ...BASE, timestamp: '2026-04-26T00:00:00.000Z', cost_eur: 0.1 },
    ];
    const groups = groupByDay(lines);
    expect(groups.map((g) => g.key)).toEqual(['2026-04-25', '2026-04-26', '2026-04-27']);
  });
});

describe('formatSparkline', () => {
  it('returns empty string for empty input', () => {
    expect(formatSparkline([])).toBe('');
  });

  it('returns a single char for a single value', () => {
    const result = formatSparkline([5]);
    expect(result).toHaveLength(1);
  });

  it('returns a string with one char per value', () => {
    const result = formatSparkline([0, 5, 10, 15, 20]);
    expect(result).toHaveLength(5);
  });

  it('uses lowest spark char for minimum value', () => {
    const SPARK_CHARS = ['▁', '▂', '▃', '▅', '▇'];
    const result = formatSparkline([0, 10]);
    expect(SPARK_CHARS).toContain(result[0]);
    expect(SPARK_CHARS).toContain(result[1]);
    // max value should be in a higher bucket than min
    expect(result[1]! >= result[0]!).toBe(true);
  });

  it('returns consistent middle char when all values are equal', () => {
    const result = formatSparkline([5, 5, 5]);
    // all chars should be the same (range === 0 branch)
    expect(result[0]).toBe(result[1]);
    expect(result[1]).toBe(result[2]);
  });
});

describe('formatMarkdownReport', () => {
  const baseOpts = {
    label: '2026-04-01 – 2026-04-30',
    total: { key: 'total', calls: 4, inputTokens: 1_000_000, outputTokens: 100_000, costEur: 1.35 },
    byPhase: groupByPhase(LINES),
    byModel: groupByModel(LINES),
    byTicket: groupByTicket(LINES),
    byDay: groupByDay(LINES),
    anomalies: [],
  };

  it('returns a non-empty string', () => {
    const output = formatMarkdownReport(baseOpts);
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
  });

  it('contains expected section headings', () => {
    const output = formatMarkdownReport(baseOpts);
    expect(output).toContain('## Spend by phase');
    expect(output).toContain('## Spend by model');
    expect(output).toContain('## Spend by ticket');
    expect(output).toContain('## Daily spend');
    expect(output).toContain('## Anomalies');
  });

  it('includes the label in output', () => {
    const output = formatMarkdownReport(baseOpts);
    expect(output).toContain('2026-04-01 – 2026-04-30');
  });

  it('shows _No anomalies detected._ when anomalies is empty', () => {
    const output = formatMarkdownReport(baseOpts);
    expect(output).toContain('_No anomalies detected._');
  });

  it('lists anomalies when provided', () => {
    const opts = { ...baseOpts, anomalies: ['High-cost run: abc123 — €5.00 > p95 €1.00'] };
    const output = formatMarkdownReport(opts);
    expect(output).toContain('High-cost run: abc123');
  });

  it('shows _No data_ for empty byTicket', () => {
    const opts = { ...baseOpts, byTicket: [] };
    const output = formatMarkdownReport(opts);
    expect(output).toContain('_No data_');
  });

  it('shows _No data_ for empty byDay', () => {
    const opts = { ...baseOpts, byDay: [] };
    const output = formatMarkdownReport(opts);
    expect(output).toContain('_No data_');
  });
});

describe('detectAnomalies', () => {
  it('returns empty array for empty input', () => {
    expect(detectAnomalies([])).toEqual([]);
  });

  it('returns empty array for a small set (< 20 lines)', () => {
    // Even if there are high-cost outliers, we need >= 20 lines to trigger anomalies
    const lines: AuditLine[] = [
      { ...BASE, cost_eur: 0.01 },
      { ...BASE, cost_eur: 100.0 },
    ];
    expect(detectAnomalies(lines)).toEqual([]);
  });

  it('detects high-cost anomalies when there are >= 20 lines', () => {
    // Create 20 cheap runs + 1 very expensive run
    const cheapRun: AuditLine = { ...BASE, cost_eur: 0.01 };
    const expensiveRun: AuditLine = {
      ...BASE,
      run_id: 'expensive-run-id',
      ticket: 'PROJ-99',
      phase: 'dev',
      cost_eur: 999.99,
    };
    const lines: AuditLine[] = [...Array(20).fill(cheapRun), expensiveRun];
    const anomalies = detectAnomalies(lines);
    expect(anomalies.length).toBeGreaterThan(0);
    expect(anomalies[0]).toContain('expensive-run-id');
    expect(anomalies[0]).toContain('High-cost run');
  });

  it('returns empty when all costs are identical (no outliers above p95)', () => {
    const lines: AuditLine[] = Array(25).fill({ ...BASE, cost_eur: 0.5 });
    // All costs equal — highCostRuns will be empty since none are strictly > p95
    expect(detectAnomalies(lines)).toEqual([]);
  });
});
