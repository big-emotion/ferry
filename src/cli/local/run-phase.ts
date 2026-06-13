import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { EventEnvelopeV1 } from '../../lib/envelope/types.js';
import { FerryError } from '../../lib/errors/index.js';

const PHASE_TO_ROLE = {
  refine: 'refiner',
  dev: 'developer',
  review: 'reviewer',
  iterate: 'iterator',
} as const;

export interface RunLocalPhaseOptions {
  repoRoot: string;
  worktreePath: string;
  envelope: EventEnvelopeV1;
  dryRun?: boolean;
}

function resolveAgentCommand(
  repoRoot: string,
  role: (typeof PHASE_TO_ROLE)[keyof typeof PHASE_TO_ROLE],
): { command: string; args: string[]; display: string } {
  const distEntry = join(repoRoot, 'dist', 'cli', 'agent', 'run.js');
  if (existsSync(distEntry)) {
    return {
      command: process.execPath,
      args: [distEntry, 'run', '--role', role],
      display: `${process.execPath} ${distEntry} run --role ${role}`,
    };
  }

  const srcEntry = join(repoRoot, 'src', 'cli', 'agent', 'run.ts');
  return {
    command: 'tsx',
    args: [srcEntry, 'run', '--role', role],
    display: `tsx ${srcEntry} run --role ${role}`,
  };
}

export function runLocalPhase(options: RunLocalPhaseOptions): void {
  if (options.envelope.phase === 'merge') {
    throw new FerryError('state-invariant', {
      reason: 'local-runner-merge-forbidden',
      ticket: options.envelope.ticket_key,
    });
  }
  if (!(options.envelope.phase in PHASE_TO_ROLE)) {
    throw new FerryError('state-invariant', {
      reason: 'local-runner-unsupported-phase',
      phase: options.envelope.phase,
    });
  }

  const role = PHASE_TO_ROLE[options.envelope.phase as keyof typeof PHASE_TO_ROLE];
  const command = resolveAgentCommand(options.repoRoot, role);

  if (options.dryRun) {
    console.log(`[ferry-local] dry-run: would run ${command.display} in ${options.worktreePath}`);
    return;
  }

  const result = spawnSync(command.command, command.args, {
    cwd: options.worktreePath,
    env: {
      ...process.env,
      FERRY_ENVELOPE_PAYLOAD: JSON.stringify(options.envelope),
    },
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(
      `[ferry-local] phase ${options.envelope.phase} failed with exit code ${result.status ?? 1}`,
    );
  }
}
