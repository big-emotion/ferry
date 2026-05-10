import type { AuditLine, GroupStats } from './types.js';

export interface FilterOpts {
  since?: Date;
  until?: Date;
}

export function filterLines(lines: AuditLine[], opts: FilterOpts): AuditLine[] {
  return lines.filter((l) => {
    const ts = new Date(l.timestamp);
    if (opts.since && ts < opts.since) return false;
    if (opts.until && ts > opts.until) return false;
    return true;
  });
}

function accumulate(map: Map<string, GroupStats>, key: string, line: AuditLine): void {
  const existing = map.get(key);
  if (existing) {
    existing.calls++;
    existing.inputTokens += line.input_tokens;
    existing.outputTokens += line.output_tokens;
    existing.costEur += line.cost_eur;
  } else {
    map.set(key, {
      key,
      calls: 1,
      inputTokens: line.input_tokens,
      outputTokens: line.output_tokens,
      costEur: line.cost_eur,
    });
  }
}

export function groupByPhase(lines: AuditLine[]): GroupStats[] {
  const map = new Map<string, GroupStats>();
  for (const line of lines) accumulate(map, line.phase, line);
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

export function groupByTicket(lines: AuditLine[]): GroupStats[] {
  const map = new Map<string, GroupStats>();
  for (const line of lines) accumulate(map, line.ticket, line);
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

export function totalStats(groups: GroupStats[]): GroupStats {
  return groups.reduce(
    (acc, g) => {
      acc.calls += g.calls;
      acc.inputTokens += g.inputTokens;
      acc.outputTokens += g.outputTokens;
      acc.costEur += g.costEur;
      return acc;
    },
    { key: 'total', calls: 0, inputTokens: 0, outputTokens: 0, costEur: 0 },
  );
}

export function groupByModel(lines: AuditLine[]): GroupStats[] {
  const map = new Map<string, GroupStats>();
  for (const line of lines) accumulate(map, line.model, line);
  return Array.from(map.values()).sort((a, b) => b.costEur - a.costEur);
}

export function groupByDay(lines: AuditLine[]): GroupStats[] {
  const map = new Map<string, GroupStats>();
  for (const line of lines) accumulate(map, line.timestamp.slice(0, 10), line);
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

/** Groups by ISO date + model ID, key format: "YYYY-MM-DD/model-id". Used by ferry-cost-reconcile. */
export function groupByDateModel(lines: AuditLine[]): GroupStats[] {
  const map = new Map<string, GroupStats>();
  for (const line of lines) {
    const date = line.timestamp.slice(0, 10);
    accumulate(map, `${date}/${line.model}`, line);
  }
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}
