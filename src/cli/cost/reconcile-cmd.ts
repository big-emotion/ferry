#!/usr/bin/env node
/**
 * ferry-cost-reconcile — diff Ferry-reported spend vs Anthropic CSV export
 *
 * Usage: npx -p @big-emotion/ferry ferry-cost-reconcile \
 *   --provider anthropic \
 *   --provider-csv ./claude_api_cost_2026_05_01_to_2026_05_09.csv \
 *   --audit-log ./ferry-audit.jsonl
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { readAuditFile } from './parse.js';
import { reconcile, formatReconcileReport } from './reconcile.js';

const USAGE = `
ferry-cost-reconcile — diff Ferry-reported spend vs Anthropic billing CSV

Usage:
  npx -p @big-emotion/ferry ferry-cost-reconcile [options]

Options:
  --provider <name>         Provider to reconcile against (only "anthropic" supported today)
  --provider-csv <path>     Path to the provider billing CSV export
  --audit-log <path>        Ferry audit log (default: ./ferry-audit.jsonl)
  --tolerance <0.0-1.0>     Acceptable relative diff (default: 0.10 = 10%)
  --format <md|json>        Output format (default: md)
  --out <path>              Write output to file instead of stdout
  -h, --help                Show this message
`.trim();

interface CliOpts {
  provider: string;
  providerCsv: string;
  auditLog: string;
  tolerance: number;
  format: 'md' | 'json';
  out?: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliOpts {
  const args = argv.slice(2);
  let provider = '';
  let providerCsv = '';
  let auditLog = './ferry-audit.jsonl';
  let tolerance = 0.1;
  let format: 'md' | 'json' = 'md';
  let out: string | undefined;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--provider') {
      provider = args[++i] ?? '';
    } else if (arg === '--provider-csv') {
      providerCsv = args[++i] ?? '';
      if (!providerCsv) {
        process.stderr.write('error: --provider-csv requires a path\n');
        process.exit(2);
      }
    } else if (arg === '--audit-log') {
      const raw = args[++i];
      if (!raw) {
        process.stderr.write('error: --audit-log requires a path\n');
        process.exit(2);
      }
      auditLog = raw;
    } else if (arg === '--tolerance') {
      const raw = args[++i] ?? '';
      const n = parseFloat(raw);
      if (isNaN(n) || n < 0 || n > 1) {
        process.stderr.write(
          `error: --tolerance must be a decimal between 0 and 1 (got "${raw}")\n`,
        );
        process.exit(2);
      }
      tolerance = n;
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

  return { provider, providerCsv, auditLog, tolerance, format, out, help };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    process.stdout.write(USAGE + '\n');
    return;
  }

  if (!opts.providerCsv) {
    process.stderr.write('error: --provider-csv is required\n\n' + USAGE + '\n');
    process.exit(2);
  }

  if (opts.provider && opts.provider !== 'anthropic') {
    process.stderr.write(
      `error: --provider "${opts.provider}" is not supported yet. Only "anthropic" is implemented.\n`,
    );
    process.exit(2);
  }

  let ferryLines;
  try {
    ferryLines = await readAuditFile(opts.auditLog);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: could not read audit log "${opts.auditLog}": ${msg}\n`);
    process.exit(1);
  }

  let providerCsv: string;
  try {
    providerCsv = readFileSync(opts.providerCsv, 'utf8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: could not read provider CSV "${opts.providerCsv}": ${msg}\n`);
    process.exit(1);
  }

  let result;
  try {
    result = reconcile(ferryLines, providerCsv, { tolerance: opts.tolerance });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: reconciliation failed: ${msg}\n`);
    process.exit(1);
  }

  let output: string;
  if (opts.format === 'json') {
    output = JSON.stringify(result, null, 2) + '\n';
  } else {
    output = formatReconcileReport(result, { tolerance: opts.tolerance });
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
    `ferry-cost-reconcile failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
