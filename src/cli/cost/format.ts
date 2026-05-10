import type { GroupStats, AuditLine } from './types.js';

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function fmtEur(n: number): string {
  return `€${n.toFixed(2)}`;
}

function fmtEurPrecise(n: number): string {
  return `€${n.toFixed(3)}`;
}

function padEnd(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

function padStart(s: string, len: number): string {
  return s.length >= len ? s : ' '.repeat(len - s.length) + s;
}

export function formatTable(groups: GroupStats[], total: GroupStats, label: string): string {
  const rows = groups.map((g) => ({
    key: g.key,
    calls: String(g.calls),
    tokens: `${fmtTokens(g.inputTokens)} / ${fmtTokens(g.outputTokens)}`,
    cost: fmtEur(g.costEur),
    avg: fmtEurPrecise(g.calls > 0 ? g.costEur / g.calls : 0),
  }));

  const header = {
    key: 'Phase',
    calls: 'Calls',
    tokens: 'Tokens (in/out)',
    cost: 'Est. cost',
    avg: 'Avg / call',
  };

  const widths = {
    key: Math.max(header.key.length, ...rows.map((r) => r.key.length)) + 2,
    calls: Math.max(header.calls.length, ...rows.map((r) => r.calls.length)) + 2,
    tokens: Math.max(header.tokens.length, ...rows.map((r) => r.tokens.length)) + 2,
    cost: Math.max(header.cost.length, ...rows.map((r) => r.cost.length)) + 2,
    avg: Math.max(header.avg.length, ...rows.map((r) => r.avg.length)) + 2,
  };

  const rowLine = (r: typeof header): string =>
    padEnd(r.key, widths.key) +
    padStart(r.calls, widths.calls) +
    '  ' +
    padEnd(r.tokens, widths.tokens) +
    padStart(r.cost, widths.cost) +
    padStart(r.avg, widths.avg);

  const totalWidth = widths.key + widths.calls + 2 + widths.tokens + widths.cost + widths.avg;
  const divider = '─'.repeat(totalWidth);

  const summaryLabel = padEnd(label, widths.key + widths.calls + 2 + widths.tokens);
  const summaryLine = summaryLabel + padStart(fmtEur(total.costEur), widths.cost);

  return [rowLine(header), divider, ...rows.map(rowLine), divider, summaryLine].join('\n');
}

export interface JsonOutput {
  groups: GroupStats[];
  total: GroupStats;
  label: string;
}

export function formatJson(groups: GroupStats[], total: GroupStats, label: string): string {
  const out: JsonOutput = { groups, total, label };
  return JSON.stringify(out, null, 2);
}

const SPARK_CHARS = ['▁', '▂', '▃', '▅', '▇'] as const;

export function formatSparkline(values: number[]): string {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  return values
    .map((v) => {
      if (range === 0) return SPARK_CHARS[2];
      const bucket = Math.min(
        SPARK_CHARS.length - 1,
        Math.floor(((v - min) / range) * SPARK_CHARS.length),
      );
      return SPARK_CHARS[bucket];
    })
    .join('');
}

export interface MarkdownReportOptions {
  label: string;
  total: GroupStats;
  byPhase: GroupStats[];
  byModel: GroupStats[];
  byTicket: GroupStats[];
  byDay: GroupStats[];
  anomalies: string[];
}

function mdTable(header: string[], rows: string[][]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const headerRow = '| ' + header.map((h, i) => h.padEnd(widths[i] ?? 0)).join(' | ') + ' |';
  const divider = '| ' + widths.map((w) => '-'.repeat(w)).join(' | ') + ' |';
  const dataRows = rows.map(
    (r) => '| ' + r.map((cell, i) => (cell ?? '').padEnd(widths[i] ?? 0)).join(' | ') + ' |',
  );
  return [headerRow, divider, ...dataRows].join('\n');
}

export function formatMarkdownReport(opts: MarkdownReportOptions): string {
  const { label, total, byPhase, byModel, byTicket, byDay, anomalies } = opts;

  const top3Phases = [...byPhase].sort((a, b) => b.costEur - a.costEur).slice(0, 3);
  const top3Str = top3Phases.map((g) => `${g.key} (${fmtEur(g.costEur)})`).join(', ');

  const lines: string[] = [];

  lines.push(`# Ferry Cost Report`);
  lines.push('');
  lines.push(`**Period:** ${label}`);
  lines.push(`**Total runs:** ${total.calls}`);
  lines.push(`**Total cost:** ${fmtEur(total.costEur)}`);
  if (top3Phases.length > 0) {
    lines.push(`**Top phases by spend:** ${top3Str}`);
  }
  lines.push('');

  // Spend by phase
  lines.push('## Spend by phase');
  lines.push('');
  lines.push(
    mdTable(
      ['Phase', 'Runs', 'Input tokens', 'Output tokens', 'Cost (EUR)', 'Avg/run'],
      byPhase.map((g) => [
        g.key,
        String(g.calls),
        fmtTokens(g.inputTokens),
        fmtTokens(g.outputTokens),
        fmtEur(g.costEur),
        fmtEurPrecise(g.calls > 0 ? g.costEur / g.calls : 0),
      ]),
    ),
  );
  lines.push('');

  // Spend by model
  lines.push('## Spend by model');
  lines.push('');
  lines.push(
    mdTable(
      ['Model', 'Runs', 'Input tokens', 'Output tokens', 'Cost (EUR)', 'Avg/run'],
      byModel.map((g) => [
        g.key,
        String(g.calls),
        fmtTokens(g.inputTokens),
        fmtTokens(g.outputTokens),
        fmtEur(g.costEur),
        fmtEurPrecise(g.calls > 0 ? g.costEur / g.calls : 0),
      ]),
    ),
  );
  lines.push('');

  // Spend by ticket (top 20)
  const topTickets = [...byTicket].sort((a, b) => b.costEur - a.costEur).slice(0, 20);
  lines.push('## Spend by ticket (top 20)');
  lines.push('');
  if (topTickets.length === 0) {
    lines.push('_No data_');
  } else {
    lines.push(
      mdTable(
        ['Ticket', 'Runs', 'Cost (EUR)', 'Avg/run'],
        topTickets.map((g) => [
          g.key,
          String(g.calls),
          fmtEur(g.costEur),
          fmtEurPrecise(g.calls > 0 ? g.costEur / g.calls : 0),
        ]),
      ),
    );
  }
  lines.push('');

  // Daily spend (last 14d)
  const last14Days = byDay.slice(-14);
  lines.push('## Daily spend (last 14 days)');
  lines.push('');
  if (last14Days.length === 0) {
    lines.push('_No data_');
  } else {
    const dailyCosts = last14Days.map((g) => g.costEur);
    const dailyAvgTokens = last14Days.map((g) =>
      g.calls > 0 ? (g.inputTokens + g.outputTokens) / g.calls : 0,
    );
    lines.push(
      mdTable(
        ['Date', 'Runs', 'Cost (EUR)'],
        last14Days.map((g) => [g.key, String(g.calls), fmtEur(g.costEur)]),
      ),
    );
    lines.push('');
    lines.push(`**Daily spend trend:** \`${formatSparkline(dailyCosts)}\``);
    lines.push(`**Tokens/run trend:**  \`${formatSparkline(dailyAvgTokens)}\``);
  }
  lines.push('');

  // Anomalies
  lines.push('## Anomalies');
  lines.push('');
  if (anomalies.length === 0) {
    lines.push('_No anomalies detected._');
  } else {
    for (const a of anomalies) {
      lines.push(`- ${a}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

export function detectAnomalies(lines: AuditLine[]): string[] {
  if (lines.length === 0) return [];
  const anomalies: string[] = [];

  // p95 cost threshold
  const costs = lines.map((l) => l.cost_eur).sort((a, b) => a - b);
  const p95Index = Math.floor(costs.length * 0.95);
  const p95Cost = costs[p95Index] ?? costs[costs.length - 1] ?? 0;

  const highCostRuns = lines.filter((l) => l.cost_eur > p95Cost);
  if (highCostRuns.length > 0 && costs.length >= 20) {
    for (const run of highCostRuns) {
      anomalies.push(
        `High-cost run: ${run.run_id} (${run.ticket} / ${run.phase}) — ${fmtEur(run.cost_eur)} > p95 ${fmtEur(p95Cost)}`,
      );
    }
  }

  // TODO: check cache_read_tokens / (cache_read_tokens + input_tokens) < 0.3
  // AuditLine does not currently include cache_read_tokens — skipping this check until #251 adds it

  // TODO: check runs hitting max_iterations
  // AuditLine does not currently include max_iterations — skipping this check until #251 adds it

  return anomalies;
}
