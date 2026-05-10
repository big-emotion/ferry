#!/usr/bin/env node
/**
 * ferry-cost-report — on-demand spend breakdown from ferry-audit.jsonl
 *
 * Usage: npx -p @big-emotion/ferry ferry-cost-report [options]
 */
import { writeFileSync } from 'node:fs';
import { readAuditFile } from './parse.js';
import {
  filterLines,
  groupByPhase,
  groupByTicket,
  groupByModel,
  groupByDay,
  totalStats,
} from './aggregate.js';
import { formatJson, formatMarkdownReport, detectAnomalies } from './format.js';

const USAGE = `
ferry-cost-report — on-demand spend breakdown from ferry-audit.jsonl

Usage:
  npx -p @big-emotion/ferry ferry-cost-report [options]

Options:
  --from <date>           ISO date lower bound (default: 30 days ago)
  --to <date>             ISO date upper bound (default: now)
  --ticket <PROJ-123>     Filter to a single ticket
  --phase <phase>         Filter by phase: refine|dev|review|iterate
  --format <fmt>          Output format: md|json|csv (default: md)
  --out <path>            Write output to file instead of stdout
  --audit-log <path>      Audit file path (default: ./ferry-audit.jsonl)
  -h, --help              Show this message
`.trim();

interface CliOpts {
  from?: Date;
  to?: Date;
  ticket?: string;
  phase?: string;
  format: 'md' | 'json' | 'csv';
  out?: string;
  auditLog: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliOpts {
  const args = argv.slice(2);
  let from: Date | undefined;
  let to: Date | undefined;
  let ticket: string | undefined;
  let phase: string | undefined;
  let format: 'md' | 'json' | 'csv' = 'md';
  let out: string | undefined;
  let auditLog = './ferry-audit.jsonl';
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--from') {
      const raw = args[++i];
      const d = new Date(raw ?? '');
      if (isNaN(d.getTime())) {
        process.stderr.write(`error: --from must be an ISO date (got "${raw}")\n`);
        process.exit(2);
      }
      from = d;
    } else if (arg === '--to') {
      const raw = args[++i];
      const d = new Date(raw ?? '');
      if (isNaN(d.getTime())) {
        process.stderr.write(`error: --to must be an ISO date (got "${raw}")\n`);
        process.exit(2);
      }
      to = d;
    } else if (arg === '--ticket') {
      ticket = args[++i];
      if (!ticket) {
        process.stderr.write('error: --ticket requires a value\n');
        process.exit(2);
      }
    } else if (arg === '--phase') {
      phase = args[++i];
      if (!phase) {
        process.stderr.write('error: --phase requires a value\n');
        process.exit(2);
      }
    } else if (arg === '--format') {
      const raw = args[++i];
      if (raw !== 'md' && raw !== 'json' && raw !== 'csv') {
        process.stderr.write(`error: --format must be md|json|csv (got "${raw}")\n`);
        process.exit(2);
      }
      format = raw;
    } else if (arg === '--out') {
      out = args[++i];
      if (!out) {
        process.stderr.write('error: --out requires a path\n');
        process.exit(2);
      }
    } else if (arg === '--audit-log') {
      const raw = args[++i];
      if (!raw) {
        process.stderr.write('error: --audit-log requires a path\n');
        process.exit(2);
      }
      auditLog = raw;
    } else {
      process.stderr.write(`error: unknown option "${arg}"\n`);
      process.exit(2);
    }
  }

  return { from, to, ticket, phase, format, out, auditLog, help };
}

function formatCsv(
  groups: { key: string; calls: number; costEur: number }[],
  label: string,
): string {
  const rows = [
    'label,key,calls,cost_eur',
    ...groups.map(
      (g) => `${JSON.stringify(label)},${JSON.stringify(g.key)},${g.calls},${g.costEur.toFixed(4)}`,
    ),
  ];
  return rows.join('\n');
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    process.stdout.write(USAGE + '\n');
    return;
  }

  let allLines;
  try {
    allLines = await readAuditFile(opts.auditLog);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: could not read "${opts.auditLog}": ${msg}\n`);
    process.exit(1);
  }

  const to = opts.to ?? new Date();
  let from = opts.from;
  if (!from) {
    from = new Date(to);
    from.setDate(from.getDate() - 30);
  }

  let filtered = filterLines(allLines, { since: from, until: to });

  if (opts.ticket) {
    filtered = filtered.filter((l) => l.ticket === opts.ticket);
  }

  if (opts.phase) {
    filtered = filtered.filter((l) => l.phase === opts.phase);
  }

  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);
  const label = `${fromStr} – ${toStr}`;

  const byPhase = groupByPhase(filtered);
  const byModel = groupByModel(filtered);
  const byTicket = groupByTicket(filtered);
  const byDay = groupByDay(filtered);
  const total = totalStats(byPhase);

  let output: string;

  if (opts.format === 'json') {
    output = formatJson(byPhase, total, label) + '\n';
  } else if (opts.format === 'csv') {
    output = formatCsv(byPhase, label) + '\n';
  } else {
    const anomalies = detectAnomalies(filtered);
    output = formatMarkdownReport({
      label,
      total,
      byPhase,
      byModel,
      byTicket,
      byDay,
      anomalies,
    });
  }

  if (opts.out) {
    writeFileSync(opts.out, output, 'utf8');
    process.stdout.write(`Report written to ${opts.out}\n`);
  } else {
    process.stdout.write(output);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `ferry-cost-report failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
