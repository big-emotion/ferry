import type { GroupStats } from './types.js';

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
