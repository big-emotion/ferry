import { describe, it, expect } from 'vitest';
import { parseAuditLines } from './parse.js';
import { filterLines, groupByPhase, groupByTicket, totalStats } from './aggregate.js';
import { formatTable, formatJson } from './format.js';
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
