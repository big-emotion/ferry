#!/usr/bin/env node
import { runPollLoop } from './poll.js';
import { serveLocalRunner } from './serve.js';

export interface ParsedArgs {
  command: 'poll' | 'serve';
  once: boolean;
  dryRun: boolean;
  port: number;
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const command = argv[2];
  if (command !== 'poll' && command !== 'serve') {
    throw new CliUsageError(
      `Unknown command: ${command ?? '(none)'}. Usage: ferry-local <poll|serve> [--once] [--dry-run] [--port <n>]`,
    );
  }

  let once = false;
  let dryRun = false;
  let port = 8787;
  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--once') {
      once = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--port') {
      const raw = argv[i + 1];
      port = parseInt(raw ?? '', 10);
      i += 1;
      continue;
    }
    throw new CliUsageError(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(port) || port <= 0) {
    throw new CliUsageError(`Invalid --port value: ${port}`);
  }

  return { command, once, dryRun, port };
}

export async function runCli(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  const repoRoot = process.cwd();
  if (args.command === 'poll') {
    await runPollLoop({ repoRoot, dryRun: args.dryRun, once: args.once });
    return;
  }
  await serveLocalRunner({ repoRoot, port: args.port, dryRun: args.dryRun });
}

const invokedDirectly =
  typeof process !== 'undefined' && /\/cli\/local\/index\.(?:js|ts)$/.test(process.argv[1] ?? '');

if (invokedDirectly) {
  void runCli(process.argv).catch((err: unknown) => {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(2);
    }
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(1);
  });
}
