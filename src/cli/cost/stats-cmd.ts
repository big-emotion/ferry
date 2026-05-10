#!/usr/bin/env node
/**
 * ferry-cost-stats — compute per-phase cost baseline from ferry-audit.jsonl
 *
 * Usage: npx -p @big-emotion/ferry ferry-cost-stats \
 *   --audit-log ./ferry-audit.jsonl \
 *   --repo owner/repo \
 *   --out ./cost-baseline.json
 */
import { writeFileSync } from 'node:fs';
import { readAuditFile } from './parse.js';
import { computeBaseline } from './stats.js';

const USAGE = `
ferry-cost-stats — compute per-phase cost baseline from ferry-audit.jsonl

Usage:
  npx -p @big-emotion/ferry ferry-cost-stats [options]

Options:
  --audit-log <path>    Ferry audit log (default: ./ferry-audit.jsonl)
  --repo <owner/repo>   Repository name (default: GITHUB_REPOSITORY env or "unknown/unknown")
  --out <path>          Write baseline JSON to file (default: ./cost-baseline.json)
  -h, --help            Show this message
`.trim();

interface CliOpts {
  auditLog: string;
  repo: string;
  out: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliOpts {
  const args = argv.slice(2);
  let auditLog = './ferry-audit.jsonl';
  let repo = process.env.GITHUB_REPOSITORY ?? 'unknown/unknown';
  let out = './cost-baseline.json';
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
    } else if (arg === '--repo') {
      const raw = args[++i];
      if (!raw) {
        process.stderr.write('error: --repo requires an owner/repo value\n');
        process.exit(2);
      }
      repo = raw;
    } else if (arg === '--out') {
      const raw = args[++i];
      if (!raw) {
        process.stderr.write('error: --out requires a path\n');
        process.exit(2);
      }
      out = raw;
    } else {
      process.stderr.write(`error: unknown option "${arg}"\n`);
      process.exit(2);
    }
  }

  return { auditLog, repo, out, help };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    process.stdout.write(USAGE + '\n');
    return;
  }

  let lines;
  try {
    lines = await readAuditFile(opts.auditLog);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: could not read audit log "${opts.auditLog}": ${msg}\n`);
    process.exit(1);
  }

  const baseline = computeBaseline(lines, opts.repo);

  try {
    writeFileSync(opts.out, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
    process.stdout.write(
      `Baseline written to ${opts.out} (${baseline.windowRuns} runs, ${baseline.byPhase.length} phases)\n`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: could not write baseline to "${opts.out}": ${msg}\n`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `ferry-cost-stats failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
