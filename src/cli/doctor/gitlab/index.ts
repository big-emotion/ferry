/**
 * `ferry-doctor --forge gitlab` runner. Aggregates the five probes from
 * `./probes.ts`, renders them via the shared table renderer, and returns the
 * exit code (0 if no red, 1 otherwise).
 */
import { renderTable } from '../table.js';
import {
  probeProjectAccess,
  probeTokenScopes,
  probePipelineTrigger,
  probeProjectVariables,
  probeJiraWebhookManual,
} from './probes.js';

export interface GitLabDoctorConfig {
  apiBase: string;
  token: string;
  projectPath: string;
  triggerToken: string;
}

interface RunOpts extends GitLabDoctorConfig {
  write: (s: string) => void;
}

function getArg(argv: readonly string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

export function parseGitLabConfig(argv: readonly string[]): GitLabDoctorConfig {
  return {
    apiBase:
      getArg(argv, '--api-base') ??
      process.env['FERRY_GITLAB_API_BASE'] ??
      'https://gitlab.com/api/v4',
    token: getArg(argv, '--token') ?? process.env['FERRY_GITLAB_TOKEN'] ?? '',
    projectPath: getArg(argv, '--project') ?? process.env['FERRY_GITLAB_PROJECT_PATH'] ?? '',
    triggerToken:
      getArg(argv, '--trigger-token') ?? process.env['FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN'] ?? '',
  };
}

export async function runGitLabDoctor(opts: RunOpts): Promise<number> {
  const { write, ...probeOpts } = opts;
  write(`\n  ferry doctor — checking GitLab project ${probeOpts.projectPath || '(unset)'}\n`);

  const results = await Promise.all([
    probeProjectAccess(probeOpts),
    probeTokenScopes(probeOpts),
    probePipelineTrigger(probeOpts),
    probeProjectVariables(probeOpts),
    probeJiraWebhookManual(),
  ]);

  write(renderTable(results));
  const anyRed = results.some((r) => r.status === 'red');
  return anyRed ? 1 : 0;
}
