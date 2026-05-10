import { describe, it, expect } from 'vitest';
import { analyseAuditLog, formatAdviceReport } from './advice.js';
import type { AuditLine } from './types.js';

const BASE: AuditLine = {
  ticket: 'PROJ-1',
  phase: 'dev',
  run_id: 'run-1',
  model: 'claude-sonnet-4-6',
  input_tokens: 50_000,
  output_tokens: 5_000,
  cost_eur: 0.2,
  outcome: 'success',
  duration_ms: 5000,
  timestamp: '2026-05-01T10:00:00.000Z',
};

function makeLine(overrides: Partial<AuditLine> = {}): AuditLine {
  return { ...BASE, ...overrides };
}

// Minimal fixture with enough runs to trigger heuristics
function makeLines(n: number, overrides: Partial<AuditLine> = {}): AuditLine[] {
  return Array.from({ length: n }, (_, i) =>
    makeLine({ ...overrides, run_id: `run-${i}`, ticket: `PROJ-${i + 1}` }),
  );
}

// ---------------------------------------------------------------------------
// Heuristic 1 — low cache hit rate
// ---------------------------------------------------------------------------

describe('heuristic: low-cache-hit', () => {
  it('fires when cache_read / total_input < 0.3 for a phase with ≥5 runs', () => {
    const lines = makeLines(6, {
      cache_read_input_tokens: 5_000,
      input_tokens: 100_000,
    });
    const result = analyseAuditLog(lines);
    const finding = result.findings.find((f) => f.id === 'low-cache-hit');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('warn');
  });

  it('does not fire when cache hit rate ≥ 0.3', () => {
    const lines = makeLines(6, {
      cache_read_input_tokens: 40_000,
      input_tokens: 100_000,
    });
    const result = analyseAuditLog(lines);
    expect(result.findings.find((f) => f.id === 'low-cache-hit')).toBeUndefined();
  });

  it('does not fire when cache_read_input_tokens is absent (pre-v0.11 logs)', () => {
    const lines = makeLines(6);
    const result = analyseAuditLog(lines);
    expect(result.findings.find((f) => f.id === 'low-cache-hit')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Heuristic 2 — iterator cap
// ---------------------------------------------------------------------------

describe('heuristic: iterator-cap', () => {
  it('fires when >30% of iterate tickets have ≥3 runs', () => {
    const lines = [
      // Ticket A: 3 iterate runs → likely capped
      makeLine({ phase: 'iterate', ticket: 'PROJ-1', run_id: 'r1' }),
      makeLine({ phase: 'iterate', ticket: 'PROJ-1', run_id: 'r2' }),
      makeLine({ phase: 'iterate', ticket: 'PROJ-1', run_id: 'r3' }),
      // Ticket B: 1 iterate run → not capped
      makeLine({ phase: 'iterate', ticket: 'PROJ-2', run_id: 'r4' }),
    ];
    const result = analyseAuditLog(lines);
    const finding = result.findings.find((f) => f.id === 'iterator-cap');
    expect(finding).toBeDefined();
  });

  it('does not fire when no iterate runs exist', () => {
    const lines = makeLines(5, { phase: 'dev' });
    const result = analyseAuditLog(lines);
    expect(result.findings.find((f) => f.id === 'iterator-cap')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Heuristic 3 — refiner input heavy
// ---------------------------------------------------------------------------

describe('heuristic: refiner-input-heavy', () => {
  it('fires when average Refiner input > 50k with ≥3 runs', () => {
    const lines = makeLines(4, { phase: 'refine', input_tokens: 80_000 });
    const result = analyseAuditLog(lines);
    expect(result.findings.find((f) => f.id === 'refiner-input-heavy')).toBeDefined();
  });

  it('does not fire when average Refiner input ≤ 50k', () => {
    const lines = makeLines(4, { phase: 'refine', input_tokens: 30_000 });
    const result = analyseAuditLog(lines);
    expect(result.findings.find((f) => f.id === 'refiner-input-heavy')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Heuristic 4 — cost outlier tickets
// ---------------------------------------------------------------------------

describe('heuristic: cost-outlier', () => {
  it('fires when a ticket is >3× median and above p95', () => {
    const base = makeLines(10, { cost_eur: 0.1 });
    const outlier = makeLine({ ticket: 'PROJ-99', cost_eur: 5.0, run_id: 'r-outlier' });
    const lines = [...base, outlier];
    const result = analyseAuditLog(lines);
    const finding = result.findings.find((f) => f.id === 'cost-outlier');
    expect(finding).toBeDefined();
    expect(finding?.evidence.some((e) => e.includes('PROJ-99'))).toBe(true);
  });

  it('does not fire with fewer than 5 distinct tickets', () => {
    const lines = makeLines(4, { cost_eur: 0.1 });
    const result = analyseAuditLog(lines);
    expect(result.findings.find((f) => f.id === 'cost-outlier')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Heuristic 5 — provider/phase mismatch
// ---------------------------------------------------------------------------

describe('heuristic: provider-phase-mismatch', () => {
  it('fires when ≥50% of Refiner runs use Opus', () => {
    const lines = [
      makeLine({ phase: 'refine', model: 'claude-opus-4-7', run_id: 'r1', ticket: 'PROJ-1' }),
      makeLine({ phase: 'refine', model: 'claude-opus-4-7', run_id: 'r2', ticket: 'PROJ-2' }),
      makeLine({ phase: 'refine', model: 'claude-sonnet-4-6', run_id: 'r3', ticket: 'PROJ-3' }),
    ];
    const result = analyseAuditLog(lines);
    expect(result.findings.find((f) => f.id === 'provider-phase-mismatch')).toBeDefined();
  });

  it('does not fire when Refiner uses Sonnet', () => {
    const lines = makeLines(3, { phase: 'refine', model: 'claude-sonnet-4-6' });
    const result = analyseAuditLog(lines);
    expect(result.findings.find((f) => f.id === 'provider-phase-mismatch')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Heuristic 6 — high output ratio
// ---------------------------------------------------------------------------

describe('heuristic: high-output-ratio', () => {
  it('fires when >30% of dev/iterate runs have output ratio >15%', () => {
    // output_tokens / (input + output) = 20_000 / 70_000 ≈ 28.6%
    const lines = makeLines(6, {
      phase: 'dev',
      input_tokens: 50_000,
      output_tokens: 20_000,
    });
    const result = analyseAuditLog(lines);
    expect(result.findings.find((f) => f.id === 'high-output-ratio')).toBeDefined();
  });

  it('does not fire when output ratio is within threshold', () => {
    // output / (input + output) = 5_000 / 55_000 ≈ 9%
    const lines = makeLines(6, {
      phase: 'dev',
      input_tokens: 50_000,
      output_tokens: 5_000,
    });
    const result = analyseAuditLog(lines);
    expect(result.findings.find((f) => f.id === 'high-output-ratio')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// analyseAuditLog — severity filter and sorting
// ---------------------------------------------------------------------------

describe('analyseAuditLog', () => {
  it('filters out info-level findings when severity=warn', () => {
    // Trigger provider-phase-mismatch (info) + refiner-input-heavy (warn)
    const lines = [
      makeLine({
        phase: 'refine',
        model: 'claude-opus-4-7',
        input_tokens: 80_000,
        run_id: 'r1',
        ticket: 'P-1',
      }),
      makeLine({
        phase: 'refine',
        model: 'claude-opus-4-7',
        input_tokens: 80_000,
        run_id: 'r2',
        ticket: 'P-2',
      }),
      makeLine({
        phase: 'refine',
        model: 'claude-opus-4-7',
        input_tokens: 80_000,
        run_id: 'r3',
        ticket: 'P-3',
      }),
    ];
    const result = analyseAuditLog(lines, { severity: 'warn' });
    expect(result.findings.every((f) => f.severity === 'warn')).toBe(true);
  });

  it('reports analysedRuns count and dateRange', () => {
    const lines = [
      makeLine({ timestamp: '2026-05-01T10:00:00.000Z', run_id: 'r1', ticket: 'P-1' }),
      makeLine({ timestamp: '2026-05-05T10:00:00.000Z', run_id: 'r2', ticket: 'P-2' }),
    ];
    const result = analyseAuditLog(lines);
    expect(result.analysedRuns).toBe(2);
    expect(result.dateRange.from).toBe('2026-05-01');
    expect(result.dateRange.to).toBe('2026-05-05');
  });

  it('returns no findings for an empty audit log', () => {
    const result = analyseAuditLog([]);
    expect(result.findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// formatAdviceReport
// ---------------------------------------------------------------------------

describe('formatAdviceReport', () => {
  it('renders no-findings message when advice list is empty', () => {
    const report = formatAdviceReport({
      findings: [],
      analysedRuns: 0,
      dateRange: { from: '', to: '' },
    });
    expect(report).toContain('No actionable findings');
  });

  it('includes ⚠️ for warn and ℹ️ for info findings', () => {
    const lines = [
      // Trigger refiner-input-heavy (warn)
      makeLine({ phase: 'refine', input_tokens: 80_000, run_id: 'r1', ticket: 'P-1' }),
      makeLine({ phase: 'refine', input_tokens: 80_000, run_id: 'r2', ticket: 'P-2' }),
      makeLine({ phase: 'refine', input_tokens: 80_000, run_id: 'r3', ticket: 'P-3' }),
      // Trigger provider-phase-mismatch (info)
      makeLine({
        phase: 'refine',
        model: 'claude-opus-4-7',
        input_tokens: 80_000,
        run_id: 'r4',
        ticket: 'P-4',
      }),
    ];
    const result = analyseAuditLog(lines);
    const report = formatAdviceReport(result);
    expect(report).toContain('⚠️');
  });
});
