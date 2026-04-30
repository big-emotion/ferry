#!/usr/bin/env tsx
/**
 * ferry-cost — surface daily/per-phase spend from ferry-audit.jsonl
 *
 * Usage: tsx scripts/ferry-cost.ts [options] [file]
 *
 * Reads ferry-audit.jsonl (or the file given as the last argument) and prints
 * a spend table grouped by phase. Accepts the raw comment export format
 * (lines starting with [ferry:audit:...] are silently skipped).
 *
 * Options:
 *   --days <n>         Show last N days (default: 7)
 *   --since <date>     ISO date lower bound (overrides --days)
 *   --until <date>     ISO date upper bound
 *   --by-ticket        Group by ticket instead of phase
 *   --json             Emit machine-readable JSON instead of table
 *   --help             Show this message
 */
import { readAuditFile } from '../src/cli/cost/parse.js';
import { filterLines, groupByPhase, groupByTicket, totalStats } from '../src/cli/cost/aggregate.js';
import { formatTable, formatJson } from '../src/cli/cost/format.js';

function parseArgs(argv: string[]): {
  file: string;
  days: number;
  since?: Date;
  until?: Date;
  byTicket: boolean;
  json: boolean;
  help: boolean;
} {
  let file = 'ferry-audit.jsonl';
  let days = 7;
  let since: Date | undefined;
  let until: Date | undefined;
  let byTicket = false;
  let json = false;
  let help = false;

  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--by-ticket') {
      byTicket = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--days') {
      const raw = args[++i];
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        process.stderr.write(`error: --days must be a positive integer (got "${raw}")\n`);
        process.exit(2);
      }
      days = n;
    } else if (arg === '--since') {
      const raw = args[++i];
      const d = new Date(raw ?? '');
      if (isNaN(d.getTime())) {
        process.stderr.write(`error: --since must be an ISO date (got "${raw}")\n`);
        process.exit(2);
      }
      since = d;
    } else if (arg === '--until') {
      const raw = args[++i];
      const d = new Date(raw ?? '');
      if (isNaN(d.getTime())) {
        process.stderr.write(`error: --until must be an ISO date (got "${raw}")\n`);
        process.exit(2);
      }
      until = d;
    } else if (!arg.startsWith('--')) {
      file = arg;
    } else {
      process.stderr.write(`error: unknown option "${arg}"\n`);
      process.exit(2);
    }
  }

  return { file, days, since, until, byTicket, json, help };
}

const USAGE = `
Usage: tsx scripts/ferry-cost.ts [options] [file]

  file              ferry-audit.jsonl path (default: ferry-audit.jsonl)

Options:
  --days <n>        Show last N days (default: 7)
  --since <date>    ISO date lower bound, e.g. 2026-04-01 (overrides --days)
  --until <date>    ISO date upper bound
  --by-ticket       Group by ticket instead of phase
  --json            Emit JSON output
  --help            Show this message
`.trim();

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    process.stdout.write(USAGE + '\n');
    return;
  }

  let allLines;
  try {
    allLines = await readAuditFile(opts.file);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: could not read "${opts.file}": ${msg}\n`);
    process.exit(1);
  }

  const until = opts.until ?? new Date();
  let since = opts.since;
  if (!since) {
    since = new Date(until);
    since.setDate(since.getDate() - opts.days);
  }

  const filtered = filterLines(allLines, { since, until });
  const groups = opts.byTicket ? groupByTicket(filtered) : groupByPhase(filtered);
  const total = totalStats(groups);

  const sinceStr = since.toISOString().slice(0, 10);
  const untilStr = until.toISOString().slice(0, 10);
  const label =
    opts.since || opts.until ? `${sinceStr} – ${untilStr}` : `Last ${opts.days} days`;

  if (opts.json) {
    process.stdout.write(formatJson(groups, total, label) + '\n');
  } else {
    process.stdout.write(formatTable(groups, total, label) + '\n');
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `ferry-cost failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
