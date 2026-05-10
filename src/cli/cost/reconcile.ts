import type { AuditLine } from './types.js';
import { groupByDateModel } from './aggregate.js';

// 1 USD = 0.93 EUR (same pinned rate as pricing.ts)
const USD_TO_EUR = 0.93;
const EUR_TO_USD = 1 / USD_TO_EUR;

// Anthropic CSV human-readable model name → Ferry model ID
const ANTHROPIC_MODEL_MAP: Record<string, string> = {
  'Claude Opus 4.5': 'claude-opus-4-5',
  'Claude Opus 4.7': 'claude-opus-4-7',
  'Claude Sonnet 4.5': 'claude-sonnet-4-5',
  'Claude Sonnet 4.6': 'claude-sonnet-4-6',
  'Claude Haiku 4.5': 'claude-haiku-4-5',
  'Claude Haiku 4.5 (20251001)': 'claude-haiku-4-5-20251001',
};

export interface ProviderRow {
  date: string;
  model: string;
  ferryModelId: string | null;
  costUsd: number;
}

export interface ReconcileRow {
  date: string;
  model: string;
  ferryUsd: number;
  providerUsd: number;
  diffUsd: number;
  diffPct: number;
  withinTolerance: boolean;
}

export interface ReconcileResult {
  rows: ReconcileRow[];
  unmatchedProvider: ProviderRow[];
  unmatchedFerry: { date: string; model: string; ferryUsd: number }[];
  totalFerryUsd: number;
  totalProviderUsd: number;
  coverage: number;
}

function normalizeCsvField(s: string): string {
  return s.replace(/^"|"$/g, '').trim();
}

function parseAnthropicCsvRow(headers: string[], fields: string[]): Record<string, string> {
  const row: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) {
    row[headers[i]!] = normalizeCsvField(fields[i] ?? '');
  }
  return row;
}

export function parseAnthropicCsv(csv: string): ProviderRow[] {
  const lines = csv.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = (lines[0] ?? '').split(',').map((h) => normalizeCsvField(h).toLowerCase());

  const dateIdx = headers.indexOf('usage_date_utc');
  const modelIdx = headers.indexOf('model');
  const costIdx = headers.indexOf('cost_usd');

  if (dateIdx === -1 || modelIdx === -1 || costIdx === -1) {
    throw new Error(
      'Anthropic CSV missing required columns: usage_date_utc, model, cost_usd. ' +
        `Found: ${headers.join(', ')}`,
    );
  }

  // Aggregate cost_usd per (date, model)
  const map = new Map<string, ProviderRow>();
  for (const line of lines.slice(1)) {
    const fields = line.split(',');
    const row = parseAnthropicCsvRow(headers, fields);
    const date = (row['usage_date_utc'] ?? '').slice(0, 10);
    const rawModel = row['model'] ?? '';
    const cost = parseFloat(row['cost_usd'] ?? '0');
    if (!date || !rawModel || isNaN(cost)) continue;

    const ferryModelId = ANTHROPIC_MODEL_MAP[rawModel] ?? null;
    const key = `${date}/${rawModel}`;
    const existing = map.get(key);
    if (existing) {
      existing.costUsd += cost;
    } else {
      map.set(key, { date, model: rawModel, ferryModelId, costUsd: cost });
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    `${a.date}/${a.model}`.localeCompare(`${b.date}/${b.model}`),
  );
}

export function reconcile(
  ferryLines: AuditLine[],
  providerCsv: string,
  opts: { tolerance?: number } = {},
): ReconcileResult {
  const tolerance = opts.tolerance ?? 0.1;

  const ferryGroups = groupByDateModel(ferryLines);
  const ferryByKey = new Map<string, number>();
  for (const g of ferryGroups) {
    const [date, ...modelParts] = g.key.split('/');
    const model = modelParts.join('/');
    ferryByKey.set(`${date ?? ''}/${model}`, g.costEur * EUR_TO_USD);
  }

  const providerRows = parseAnthropicCsv(providerCsv);
  const providerByFerryKey = new Map<string, number>();
  const unmatchedProvider: ProviderRow[] = [];

  for (const p of providerRows) {
    if (!p.ferryModelId) {
      unmatchedProvider.push(p);
      continue;
    }
    const key = `${p.date}/${p.ferryModelId}`;
    providerByFerryKey.set(key, (providerByFerryKey.get(key) ?? 0) + p.costUsd);
  }

  const rows: ReconcileRow[] = [];
  const matchedFerryKeys = new Set<string>();

  for (const [key, providerUsd] of providerByFerryKey) {
    const ferryUsd = ferryByKey.get(key) ?? 0;
    const diffUsd = ferryUsd - providerUsd;
    const diffPct = providerUsd > 0 ? Math.abs(diffUsd) / providerUsd : 0;
    const [date, ...modelParts] = key.split('/');
    rows.push({
      date: date ?? '',
      model: modelParts.join('/'),
      ferryUsd,
      providerUsd,
      diffUsd,
      diffPct,
      withinTolerance: diffPct <= tolerance,
    });
    matchedFerryKeys.add(key);
  }

  const unmatchedFerry: { date: string; model: string; ferryUsd: number }[] = [];
  for (const [key, ferryUsd] of ferryByKey) {
    if (!matchedFerryKeys.has(key) && ferryUsd > 0) {
      const [date, ...modelParts] = key.split('/');
      unmatchedFerry.push({ date: date ?? '', model: modelParts.join('/'), ferryUsd });
    }
  }

  rows.sort((a, b) => `${a.date}/${a.model}`.localeCompare(`${b.date}/${b.model}`));
  unmatchedFerry.sort((a, b) => `${a.date}/${a.model}`.localeCompare(`${b.date}/${b.model}`));

  const totalFerryUsd = rows.reduce((s, r) => s + r.ferryUsd, 0);
  const totalProviderUsd = rows.reduce((s, r) => s + r.providerUsd, 0);
  const coverage = totalProviderUsd > 0 ? totalFerryUsd / totalProviderUsd : 0;

  return { rows, unmatchedProvider, unmatchedFerry, totalFerryUsd, totalProviderUsd, coverage };
}

export function formatReconcileReport(
  result: ReconcileResult,
  opts: { tolerance: number },
): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const usd = (n: number) => `$${n.toFixed(4)}`;
  const sign = (n: number) => (n >= 0 ? '+' : '') + usd(n);

  const lines: string[] = [];
  lines.push('# Ferry Cost Reconciliation');
  lines.push('');
  lines.push(`**Tolerance:** ${pct(opts.tolerance)}`);
  lines.push(
    `**Ferry total (converted to USD):** ${usd(result.totalFerryUsd)}  ` +
      `**Provider total:** ${usd(result.totalProviderUsd)}`,
  );
  lines.push(`**Coverage:** ${pct(result.coverage)} of provider spend explained by Ferry`);
  lines.push('');

  if (result.rows.length > 0) {
    lines.push('## Per-day × model');
    lines.push('');
    lines.push('| Date | Model | Ferry USD | Provider USD | Diff USD | Diff % | Status |');
    lines.push('| ---- | ----- | --------- | ------------ | -------- | ------ | ------ |');
    for (const r of result.rows) {
      const status = r.withinTolerance ? '✅' : '⚠️';
      lines.push(
        `| ${r.date} | ${r.model} | ${usd(r.ferryUsd)} | ${usd(r.providerUsd)} | ${sign(r.diffUsd)} | ${pct(r.diffPct)} | ${status} |`,
      );
    }
    lines.push('');
  }

  if (result.unmatchedProvider.length > 0) {
    lines.push('## Provider rows Ferry cannot explain');
    lines.push('');
    lines.push(
      '_These dates/models appear in the provider CSV but have no matching Ferry audit entry — likely manual API usage or a model not yet in the normalization table._',
    );
    lines.push('');
    lines.push('| Date | Provider Model | Cost USD |');
    lines.push('| ---- | -------------- | -------- |');
    for (const p of result.unmatchedProvider) {
      lines.push(`| ${p.date} | ${p.model} | ${usd(p.costUsd)} |`);
    }
    lines.push('');
  }

  if (result.unmatchedFerry.length > 0) {
    lines.push('## Ferry runs not found in provider CSV');
    lines.push('');
    lines.push(
      '_These Ferry audit entries have no matching provider row — possibly test runs, runs against a non-Anthropic provider, or date range mismatch._',
    );
    lines.push('');
    lines.push('| Date | Model | Ferry USD |');
    lines.push('| ---- | ----- | --------- |');
    for (const f of result.unmatchedFerry) {
      lines.push(`| ${f.date} | ${f.model} | ${usd(f.ferryUsd)} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
