import { describe, it, expect } from 'vitest';
import { parseAnthropicCsv, reconcile, formatReconcileReport } from './reconcile.js';
import { groupByDateModel } from './aggregate.js';
import type { AuditLine } from './types.js';

const makeAuditLine = (overrides: Partial<AuditLine> = {}): AuditLine => ({
  ticket: 'PROJ-1',
  phase: 'dev',
  run_id: 'run-1',
  model: 'claude-sonnet-4-6',
  input_tokens: 100_000,
  output_tokens: 10_000,
  cost_eur: 0.42,
  outcome: 'success',
  duration_ms: 5000,
  timestamp: '2026-05-01T10:00:00.000Z',
  ...overrides,
});

const ANTHROPIC_CSV_HEADER =
  'usage_date_utc,model,workspace,api_key,usage_type,context_window,token_type,cost_usd,list_price_usd,cost_type,inference_geo,speed';

function makeAnthropicCsv(rows: { date: string; model: string; cost_usd: number }[]): string {
  const dataRows = rows.map(
    (r) =>
      `${r.date},${r.model},my-workspace,key-1,api,200k,input_no_cache,${r.cost_usd},${r.cost_usd},standard,us,standard`,
  );
  return [ANTHROPIC_CSV_HEADER, ...dataRows].join('\n');
}

// ---------------------------------------------------------------------------
// groupByDateModel
// ---------------------------------------------------------------------------

describe('groupByDateModel', () => {
  it('groups by date/model key', () => {
    const lines: AuditLine[] = [
      makeAuditLine({
        timestamp: '2026-05-01T10:00:00.000Z',
        model: 'claude-sonnet-4-6',
        cost_eur: 0.1,
      }),
      makeAuditLine({
        timestamp: '2026-05-01T12:00:00.000Z',
        model: 'claude-sonnet-4-6',
        cost_eur: 0.2,
      }),
      makeAuditLine({
        timestamp: '2026-05-02T10:00:00.000Z',
        model: 'claude-sonnet-4-6',
        cost_eur: 0.15,
      }),
    ];
    const groups = groupByDateModel(lines);
    expect(groups).toHaveLength(2);
    const may1 = groups.find((g) => g.key === '2026-05-01/claude-sonnet-4-6');
    expect(may1?.costEur).toBeCloseTo(0.3);
  });
});

// ---------------------------------------------------------------------------
// parseAnthropicCsv
// ---------------------------------------------------------------------------

describe('parseAnthropicCsv', () => {
  it('parses valid CSV and maps known model names', () => {
    const csv = makeAnthropicCsv([
      { date: '2026-05-01', model: 'Claude Sonnet 4.6', cost_usd: 0.45 },
    ]);
    const rows = parseAnthropicCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ferryModelId).toBe('claude-sonnet-4-6');
    expect(rows[0]?.costUsd).toBeCloseTo(0.45);
  });

  it('aggregates multiple rows for the same date/model', () => {
    const csv = makeAnthropicCsv([
      { date: '2026-05-01', model: 'Claude Sonnet 4.6', cost_usd: 0.2 },
      { date: '2026-05-01', model: 'Claude Sonnet 4.6', cost_usd: 0.25 },
    ]);
    const rows = parseAnthropicCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.costUsd).toBeCloseTo(0.45);
  });

  it('marks unknown model names with null ferryModelId', () => {
    const csv = makeAnthropicCsv([
      { date: '2026-05-01', model: 'Claude Mysterious 9.9', cost_usd: 1.0 },
    ]);
    const rows = parseAnthropicCsv(csv);
    expect(rows[0]?.ferryModelId).toBeNull();
  });

  it('throws on missing required columns', () => {
    expect(() => parseAnthropicCsv('foo,bar\n1,2')).toThrow('missing required columns');
  });

  it('returns empty array for empty or header-only CSV', () => {
    expect(parseAnthropicCsv('')).toEqual([]);
    expect(parseAnthropicCsv(ANTHROPIC_CSV_HEADER)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// reconcile
// ---------------------------------------------------------------------------

describe('reconcile', () => {
  it('matches Ferry and provider rows within tolerance', () => {
    // Ferry: 0.42 EUR on 2026-05-01 with claude-sonnet-4-6
    // Provider: 0.45 USD on same day (close to 0.42/0.93 ≈ 0.4516 USD → within 10%)
    const ferryLines: AuditLine[] = [
      makeAuditLine({ timestamp: '2026-05-01T10:00:00.000Z', cost_eur: 0.42 }),
    ];
    const csv = makeAnthropicCsv([
      { date: '2026-05-01', model: 'Claude Sonnet 4.6', cost_usd: 0.45 },
    ]);
    const result = reconcile(ferryLines, csv, { tolerance: 0.1 });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.withinTolerance).toBe(true);
    expect(result.unmatchedProvider).toHaveLength(0);
    expect(result.unmatchedFerry).toHaveLength(0);
  });

  it('flags rows outside tolerance', () => {
    const ferryLines: AuditLine[] = [
      makeAuditLine({ timestamp: '2026-05-01T10:00:00.000Z', cost_eur: 0.1 }),
    ];
    const csv = makeAnthropicCsv([
      { date: '2026-05-01', model: 'Claude Sonnet 4.6', cost_usd: 0.5 },
    ]);
    const result = reconcile(ferryLines, csv, { tolerance: 0.1 });
    expect(result.rows[0]?.withinTolerance).toBe(false);
  });

  it('classifies provider rows with unknown model as unmatchedProvider', () => {
    const ferryLines: AuditLine[] = [];
    const csv = makeAnthropicCsv([
      { date: '2026-05-01', model: 'Claude Mysterious 9.9', cost_usd: 1.0 },
    ]);
    const result = reconcile(ferryLines, csv, {});
    expect(result.unmatchedProvider).toHaveLength(1);
    expect(result.rows).toHaveLength(0);
  });

  it('classifies Ferry runs with no provider match as unmatchedFerry', () => {
    const ferryLines: AuditLine[] = [
      makeAuditLine({ timestamp: '2026-05-03T10:00:00.000Z', cost_eur: 0.3 }),
    ];
    // Provider CSV only covers 2026-05-01
    const csv = makeAnthropicCsv([
      { date: '2026-05-01', model: 'Claude Sonnet 4.6', cost_usd: 0.45 },
    ]);
    const result = reconcile(ferryLines, csv, {});
    expect(result.unmatchedFerry).toHaveLength(1);
    expect(result.unmatchedFerry[0]?.date).toBe('2026-05-03');
  });

  it('computes coverage as ferry / provider ratio', () => {
    const ferryLines: AuditLine[] = [
      makeAuditLine({ timestamp: '2026-05-01T10:00:00.000Z', cost_eur: 0.42 }),
    ];
    const csv = makeAnthropicCsv([
      { date: '2026-05-01', model: 'Claude Sonnet 4.6', cost_usd: 0.451 },
    ]);
    const result = reconcile(ferryLines, csv, {});
    // ferryUsd ≈ 0.42 / 0.93 ≈ 0.4516; providerUsd = 0.451
    expect(result.coverage).toBeGreaterThan(0.9);
    expect(result.coverage).toBeLessThan(1.1);
  });
});

// ---------------------------------------------------------------------------
// formatReconcileReport
// ---------------------------------------------------------------------------

describe('formatReconcileReport', () => {
  it('renders a markdown table with within-tolerance and out-of-tolerance rows', () => {
    const result = reconcile(
      [
        makeAuditLine({ timestamp: '2026-05-01T10:00:00.000Z', cost_eur: 0.42 }),
        makeAuditLine({ timestamp: '2026-05-02T10:00:00.000Z', cost_eur: 0.1 }),
      ],
      makeAnthropicCsv([
        { date: '2026-05-01', model: 'Claude Sonnet 4.6', cost_usd: 0.45 },
        { date: '2026-05-02', model: 'Claude Sonnet 4.6', cost_usd: 0.5 },
      ]),
      { tolerance: 0.1 },
    );
    const report = formatReconcileReport(result, { tolerance: 0.1 });
    expect(report).toContain('# Ferry Cost Reconciliation');
    expect(report).toContain('✅');
    expect(report).toContain('⚠️');
    expect(report).toContain('Per-day × model');
  });

  it('includes unmatched sections when present', () => {
    const result = reconcile(
      [makeAuditLine({ timestamp: '2026-05-03T10:00:00.000Z', cost_eur: 0.2 })],
      makeAnthropicCsv([{ date: '2026-05-01', model: 'Claude Mysterious 9.9', cost_usd: 1.0 }]),
      {},
    );
    const report = formatReconcileReport(result, { tolerance: 0.1 });
    expect(report).toContain('Provider rows Ferry cannot explain');
    expect(report).toContain('Ferry runs not found in provider CSV');
  });
});
