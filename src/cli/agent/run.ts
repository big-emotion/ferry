#!/usr/bin/env node
/**
 * ferry-agent CLI — single entrypoint for every Ferry agent role.
 *
 * Usage:
 *   ferry-agent run --role <refiner|developer|reviewer|iterator|merger>
 *
 * Reads the envelope from FERRY_ENVELOPE_PAYLOAD (validated by runAgent),
 * then dispatches to the role's `main` handler.
 */
import { runAgent, type AgentRole } from '../../lib/agent-runtime/index.js';
import { main as refinerMain } from '../../agents/refiner/refiner-action.js';
import { main as developerMain } from '../../agents/developer/dev-action.js';
import { main as reviewerMain } from '../../agents/reviewer/review-action.js';
import { main as iteratorMain } from '../../agents/iterator/iterate-action.js';
import { main as mergerMain } from '../../agents/merger/merge-action.js';

const ROLES: ReadonlySet<AgentRole> = new Set([
  'refiner',
  'developer',
  'reviewer',
  'iterator',
  'merger',
] as const);

const HANDLERS = {
  refiner: refinerMain,
  developer: developerMain,
  reviewer: reviewerMain,
  iterator: iteratorMain,
  merger: mergerMain,
} as const satisfies Record<AgentRole, Parameters<typeof runAgent>[1]>;

export interface ParsedArgs {
  command: 'run';
  role: AgentRole;
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

function isAgentRole(value: string): value is AgentRole {
  return (ROLES as ReadonlySet<string>).has(value);
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  // argv shape: [node, script, command, ...flags]
  const command = argv[2];
  if (command !== 'run') {
    throw new CliUsageError(
      `Unknown command: ${command ?? '(none)'}. Usage: ferry-agent run --role <role>`,
    );
  }
  const rest = argv.slice(3);
  let role: string | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (flag === '--role') {
      role = rest[i + 1];
      i += 1;
      continue;
    }
    if (flag.startsWith('--role=')) {
      role = flag.slice('--role='.length);
      continue;
    }
    throw new CliUsageError(`Unknown argument: ${flag}`);
  }
  if (!role) {
    throw new CliUsageError(
      'Missing --role flag. Usage: ferry-agent run --role <refiner|developer|reviewer|iterator|merger>',
    );
  }
  if (!isAgentRole(role)) {
    throw new CliUsageError(
      `Invalid role: ${role}. Expected one of: refiner, developer, reviewer, iterator, merger.`,
    );
  }
  return { command: 'run', role };
}

export async function runCli(argv: readonly string[]): Promise<void> {
  const { role } = parseArgs(argv);
  await runAgent(role, HANDLERS[role]);
}

// Auto-invoke when this module is the process entrypoint (not when imported by tests).
const invokedDirectly = typeof process !== 'undefined' && process.argv[1]?.endsWith('agent.js');
if (invokedDirectly) {
  void runCli(process.argv).catch((err: unknown) => {
    if (err instanceof CliUsageError) {
      // CLI usage errors go to stderr without a stack trace.
      process.stderr.write(`${err.message}\n`);
      process.exit(2);
    }
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(1);
  });
}
