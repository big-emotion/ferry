#!/usr/bin/env node
/**
 * ferry-cost-advice — actionable cost optimisation recommendations from ferry-audit.jsonl
 *
 * Usage: npx -p @big-emotion/ferry ferry-cost-advice [options]
 */
import { writeFileSync } from 'node:fs';
import { readAuditFile } from './parse.js';
import { analyseAuditLog, formatAdviceReport } from './advice.js';
import type { Severity } from './advice.js';

const USAGE = `
ferry-cost-advice — actionable cost optimisation recommendations

Usage:
  npx -p @big-emotion/ferry ferry-cost-advice [options]

Options:
  --audit-log <path>      Ferry audit log path (default: ./ferry-audit.jsonl)
  --from <date>           ISO date lower bound (default: 30 days ago)
  --to <date>             ISO date upper bound (default: now)
  --severity <info|warn>  Minimum severity to include (default: info)
  --format <md|json>      Output format (default: md)
  --out <path>            Write output to file instead of stdout
  -h, --help              Show this message
`.trim();

interface CliOpts {
  auditLog: string;
  from?: Date;
  to?: Date;
  severity: Severity;
  format: 'md' | 'json';
  out?: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliOpts {
  const args = argv.slice(2);
  let auditLog = './ferry-audit.jsonl';
  let from: Date | undefined;
  let to: Date | undefined;
  let severity: Severity = 'info';
  let format: 'md' | 'json' = 'md';
  let out: string | undefined;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--audit-log') {
      const raw = args[++i];
      if (!raw) {
        process.stderr.write('error: --audit-log requires a path\n');
        process.exit(2);
      }
      auditLog = raw;
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
    } else if (arg === '--severity') {
      const raw = args[++i];
      if (raw !== 'info' && raw !== 'warn') {
        process.stderr.write(`error: --severity must be info|warn (got "${raw}")\n`);
        process.exit(2);
      }
      severity = raw;
    } else if (arg === '--format') {
      const raw = args[++i];
      if (raw !== 'md' && raw !== 'json') {
        process.stderr.write(`error: --format must be md|json (got "${raw}")\n`);
        process.exit(2);
      }
      format = raw;
    } else if (arg === '--out') {
      out = args[++i];
      if (!out) {
        process.stderr.write('error: --out requires a path\n');
        process.exit(2);
      }
    } else {
      process.stderr.write(`error: unknown option "${arg}"\n`);
      process.exit(2);
    }
  }

  return { auditLog, from, to, severity, format, out, help };
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
    process.stderr.write(`error: could not read audit log "${opts.auditLog}": ${msg}\n`);
    process.exit(1);
  }

  const to = opts.to ?? new Date();
  let from = opts.from;
  if (!from) {
    from = new Date(to);
    from.setDate(from.getDate() - 30);
  }

  const result = analyseAuditLog(allLines, { since: from, until: to, severity: opts.severity });

  let output: string;
  if (opts.format === 'json') {
    output = JSON.stringify(result, null, 2) + '\n';
  } else {
    output = formatAdviceReport(result);
  }

  if (opts.out) {
    writeFileSync(opts.out, output, 'utf8');
    process.stdout.write(`Report written to ${opts.out}\n`);
  } else {
    process.stdout.write(output);
  }
  // exits 0 even with findings — warnings, not failures
}

main().catch((err: unknown) => {
  process.stderr.write(
    `ferry-cost-advice failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
